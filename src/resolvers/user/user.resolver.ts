import {Resolver, Mutation, Query } from '@nestjs/graphql';
import {Inject} from '@nestjs/common';
import {UserService} from '../../service/user/user.service';
import {CreateUserInput, UpdateUserInput} from '../../interfaces/user/user.interface';
import {PagerUtil} from '../../utils/pager.util';
let result;
@Resolver('user')
export class UserResolver {
    constructor(
        @Inject(UserService) private readonly userService: UserService,
        @Inject(PagerUtil) private readonly pagerUtil: PagerUtil,
    ) {}
    @Query('login')
    async login(obj, body: {userName: string, password: string}) {
        result = await this.userService.login(body.userName, body.password);
        return result;
    }
    @Query('findAllUser')
    async findAllUser(obj, body: {pageSize: number, pageNumber: number, roleId: number, userName: string}){
        result = await this.userService.findAllUser(body.pageSize, body.pageNumber, body.roleId, body.userName);
        result.pagination = await this.pagerUtil.getPager(result.totalItems, body.pageNumber, body.pageSize);
        return result;
    }
    @Mutation('createUser')
    async createUser(obj, body: {createUserInput: CreateUserInput}) {
        result = await this.userService.createUser(body.createUserInput);
        return result;
    }
    @Mutation('deleteUser')
    async deleteUser(obj, body: {id: number}) {
        await this.userService.deleteUser(body.id);
        return {code: 200, message: '删除成功'};
    }
    @Mutation('updateUserInfo')
    async updateUserInfo(obj, body: {id: number, updateUserInput: UpdateUserInput }){
        result = await this.userService.updateUserInfo(body.id, body.updateUserInput);
        return result;
    }
    @Mutation('revertBannedOrRecycledUser')
    async revertBannedOrRecycledUser(body: {id: number, status: 'recycled' | 'banned'}){
        result = await this.userService.revertBannedOrRecycledUser(body.id, body.status);
        return result;
    }
    @Mutation('recycleOrBanUser')
    async recycleOrBanUser(body: {id: number, action: 'recycle' | 'ban'}){
        result = await this.userService.recycleOrBanUser(body.id, body.action);
        return result;
    }
}