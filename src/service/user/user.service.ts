import {Inject, Injectable} from '@nestjs/common';
import {User} from '../../model/user/users.entity';
import {In, Not, Repository} from 'typeorm';
import {InjectRepository} from '@nestjs/typeorm';
import { __ as t } from 'i18n';
import {CreateUserInput, UpdateUserInput, UserInfoData} from '../../interfaces/user/user.interface';
import {CryptoUtil} from '../../utils/crypto.util';
import {UserInfoEntity} from '../../model/user/user.info.entity';
import {UserLoginLogsEntity} from '../../model/user/user.login.logs.entity';
import {InfoItemEntity} from '../../model/user/info.item.entity';
import {AuthService} from './auth.service';
import {asapScheduler} from "rxjs";

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(User) private readonly userRepo: Repository<User>,
        @InjectRepository(UserInfoEntity) private readonly userInfoRepo: Repository<UserInfoEntity>,
        @InjectRepository(InfoItemEntity) private readonly infoItemRepo: Repository<InfoItemEntity>,
        @InjectRepository(UserLoginLogsEntity) private readonly loginLogRepo: Repository<UserLoginLogsEntity>,
        @Inject(CryptoUtil) private readonly cryptoUtil: CryptoUtil,
        @Inject(AuthService) private readonly authService: AuthService
    ) {}

    /**
     * 添加用户
     * @param createUserInput
     */
    async createUser(createUserInput: CreateUserInput) {
        if (!(createUserInput.username || createUserInput.password)) {
            return {code: 404, message: '参数错误'};
        }
        if (createUserInput.username && await this.userRepo.findOne({ where: { username: createUserInput.username } })) {
            return {code: 404, message: '当前用户名已使用' };
        }
        createUserInput.password = await this.cryptoUtil.encryptPassword(createUserInput.password);
        const user = await this.userRepo.save(this.userRepo.create(createUserInput));
        if (createUserInput.roleIds && createUserInput.roleIds.length) {
            await this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(user).add(createUserInput.roleIds);
        }
        if (createUserInput.organizationIds && createUserInput.organizationIds.length) {
            await this.userRepo.createQueryBuilder('user').relation(User, 'organizations').of(user).add(createUserInput.organizationIds);
        }
        if (createUserInput.infoKVs && createUserInput.infoKVs.length) {
            await this.createOrUpdateUserInfos(user, createUserInput.infoKVs, 'create');
        }
        return {code: 200, message: '添加成功'};
    }
    /**
     * Delete user to recycle bin or ban user
     *
     * @param id The specified user id
     */
    async recycleOrBanUser(id: number, action: 'recycle' | 'ban'): Promise<void> {
        const user = await this.userRepo.findOne(id);
        if (action === 'recycle') {
            user.recycle = true;
        }
        if (action === 'ban') {
            user.banned = true;
        }
        await this.userRepo.save(user);
    }

    /**
     * 添加用户信息组
     * @param user
     * @param infoKVs
     * @param action
     */
    private async createOrUpdateUserInfos(user: User, infoKVs: { key: number, value: string, relationId?: number }[], action: 'create' | 'update') {
        if (infoKVs.length) {
            if (action === 'create') {
                infoKVs.forEach(async infoKV => {
                    await this.userInfoRepo.save(this.userInfoRepo.create({ value: infoKV.value, user, infoItem: { id: infoKV.key } }));
                });
                return;
            }

            infoKVs.forEach(async infoKV => {
                if (infoKV.key) {
                    await this.userInfoRepo.update(infoKV.key, { value: infoKV.value });
                } else {
                    await this.userInfoRepo.save(this.userInfoRepo.create({ value: infoKV.value, user, infoItem: { id: infoKV.relationId } }));
                }
            });
        }
    }

    /**
     * 用户登录
     * @param loginName
     * @param password
     */
    async login(loginName: string, password: string) {
        const user = await this.userRepo.createQueryBuilder('user')
            .leftJoinAndSelect('user.roles', 'roles')
            .leftJoinAndSelect('user.userInfos', 'userInfos')
            .leftJoinAndSelect('userInfos.infoItem', 'infoItem')
            .where('user.username = :loginName', { loginName })
            .getOne();

        if (!user) return{ code: 404, message: '当前用户不存在' };
        if (user.banned || user.recycle) return{ code: 400, message: '当前账号已被封禁或在回收站中' };
        if (!await this.cryptoUtil.checkPassword(password, user.password)) {
            return{ code: 404, message: '用户名或密码错误' };
        }
        // 用户信息
        const infoItem = await this.infoItemRepo.createQueryBuilder('infoItem')
            .leftJoin('infoItem.infoGroups', 'infoGroups')
            .leftJoin('infoGroups.role', 'role')
            .leftJoin('role.users', 'users')
            .where('users.username = :loginName', { loginName })
            .orWhere('users.mobile = :loginName', { loginName })
            .orderBy('infoItem.order', 'ASC')
            .getMany();
        const userInfoData = this.refactorUserData(user, infoItem);
        const tokenInfo = await this.authService.createToken({ loginName });
        return { code: 200, message: '登录成功' , tokenInfo, userInfoData };
    }
    /**
     * Delete users in the recycle bin
     *
     * @param id The specified user id
     */
    async deleteUser(id: number): Promise<void> {
        const user = await this.userRepo.findOne(id, { relations: ['roles', 'organizations'] });
        await this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(user).remove(user.roles);
      //  await this.userRepo.createQueryBuilder('user').relation(User, 'organizations').of(user).remove(user.organizations);
        await this.userRepo.remove(user);
    }

    /**
     * Revert user from which was banned or recycled
     *
     * @param id The specified user id
     */
    async revertBannedOrRecycledUser(id: number, status: 'recycled' | 'banned') {
        const user = await this.userRepo.findOne(id);
        if (status === 'recycled') {
            user.recycle = false;
        }
        if (status === 'banned') {
            user.banned = false;
        }
        await this.userRepo.save(user);
    }

    /**
     * Update user's information
     *
     * @param id The specified user id
     * @param updateUserInput The information to be update
     */
    async updateUserInfo(id: number, updateUserInput: UpdateUserInput) {
        const user = await this.userRepo.findOne(id, { relations: ['userInfos'] });
        if (updateUserInput.username) {
            if (await this.userRepo.findOne({ where: { username: updateUserInput.username } })) {
                return {code: 404, message: '用户名已存在'};
            }
            await this.userRepo.update(user.id, { username: updateUserInput.username });
        }
        if (updateUserInput.mobile) {
            if (await this.userRepo.findOne({ where: { mobile: updateUserInput.mobile } })) {
                return {code: 404, message: '手机号码已存在'};
            }
            await this.userRepo.update(user.id, { mobile: updateUserInput.mobile });
        }
        if (updateUserInput.password) {
            const newPassword = await this.cryptoUtil.encryptPassword(updateUserInput.password);
            await this.userRepo.update(user.id, { password: newPassword });
        }
        if (updateUserInput.roleIds && updateUserInput.roleIds.length) {
            updateUserInput.roleIds.forEach(async roleId => {
                await this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(user).remove(roleId.before);
                await this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(user).add(roleId.after);
            });
        }
        if (updateUserInput.organizationIds && updateUserInput.organizationIds.length) {
            updateUserInput.organizationIds.forEach(async organizationId => {
                await this.userRepo.createQueryBuilder('user').relation(User, 'organizations').of(user).remove(organizationId.before);
                await this.userRepo.createQueryBuilder('user').relation(User, 'organizations').of(user).add(organizationId.after);
            });
        }
        if (updateUserInput.infoKVs && updateUserInput.infoKVs.length) {
            await this.createOrUpdateUserInfos(user, updateUserInput.infoKVs, 'update');
        }
    }


    /**
     * 重构用户数据
     * @param user
     * @param infoItems
     */
    private refactorUserData(user: User, infoItems: InfoItemEntity[]) {
        const userInfoData: UserInfoData = {
            userId: user.id,
            username: user.username,
            mobile: user.mobile,
            banned: user.banned,
            recycle: user.recycle,
            createTime: user.createTime,
            updateTime: user.updateTime,
            userRoles: user.roles,
            userInfos: infoItems.length ? infoItems.map(infoItem => {
                const userInfo = user.userInfos.find(userInfo => userInfo.infoItem.id === infoItem.id);
                return {
                    id: user.userInfos.length ? (userInfo ? userInfo.id : undefined) : undefined,
                    order: infoItem.order,
                    relationId: infoItem.id,
                    type: infoItem.type,
                    name: infoItem.name,
                    value: user.userInfos.length ? (userInfo ? userInfo.value : undefined) : undefined,
                    description: infoItem.description,
                    registerDisplay: infoItem.registerDisplay,
                    informationDisplay: infoItem.informationDisplay
                };
            }) : []
        };
        return userInfoData;
    }

    /**
     * 查询所有用户
     * @param pageSize
     * @param pageNumber
     * @param roleId
     * @param userName
     */
    async findAllUser(pageSize: number, pageNumber: number, roleId: number, userName: string) {
      /*  const users = await this.userRepo.createQueryBuilder('user')
            .leftJoinAndSelect('user.roles', 'roles')
            .where('user.userName like :userName ',  { userName: `%${userName ? userName : ''}%`})
            .andWhere('case when :roleId1 <> 0 then roles.id = :roleId2 else roles.id is not null end', {
                roleId1: roleId ? roleId : 0,
                roleId2: roleId ? roleId : 0
            })
            .andWhere('user.recycle = false')
            .skip(pageSize * (pageNumber - 1))
            .take(pageSize)
            .getManyAndCount();*/
        const users = await this.userRepo.findAndCount({
            where: {
                username: `%${userName ? userName : ''}%`,
                roles: roleId ? roleId : Not(undefined),
            },
            join: {
                alias: 'roles',
            },
            relations: ['roles'],
            skip: pageSize * (pageNumber - 1),
            take: pageSize
        });
        console.log('返回结果是');
        console.log(users[0]);
        if (!users[0].length) {
            return {code: 404, message: '没有找到用户'};
        }
        const result = await this.findUserInfoById(users[0].map(user => user.id));
        return {code: 200, message: '查找成功', totalItems: users[1], users: result};
    }
    async findUserInfoById(id: number | number[]): Promise<UserInfoData | UserInfoData[]> {
        const userQb = this.userRepo.createQueryBuilder('user')
            .leftJoinAndSelect('user.roles', 'roles')
            .leftJoinAndSelect('user.userInfos', 'userInfos')
            .leftJoinAndSelect('userInfos.infoItem', 'infoItem');

        const infoItemQb = await this.infoItemRepo.createQueryBuilder('infoItem')
            .leftJoin('infoItem.infoGroups', 'infoGroups')
            .leftJoin('infoGroups.role', 'role')
            .leftJoin('role.users', 'users');
        if (id instanceof Array) {
            const userInfoData: UserInfoData[] = [];
            const users = await userQb.whereInIds(id).getMany();
            const infoItems = await infoItemQb.where('users.id IN (:...id)', { id }).orderBy('infoItem.order', 'ASC').getMany();
            for (const user of users) {
                (userInfoData as UserInfoData[]).push(this.refactorUserData(user, infoItems));
            }
            return userInfoData;
        } else {
            const user = await userQb.where('user.id = :id', { id }).getOne();
            const infoItem = await infoItemQb.where('users.id = :id', { id }).orderBy('infoItem.order', 'ASC').getMany();
            return this.refactorUserData(user, infoItem);
        }
    }

}