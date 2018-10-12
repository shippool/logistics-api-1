import {HttpException, Inject, Injectable} from '@nestjs/common';
import {HttpUtil} from '../../utils/http.util';
import dhlApi from '../../config/dhl/api.config';
import {DhlLabelReqBody} from '../../interfaces/dhl/dhl.label.req.body';
import {InjectRepository} from '@nestjs/typeorm';
import {TokenEntity} from '../../model/ahl/token.entity';
import {Repository} from 'typeorm';
import {DhlReqHeader} from '../../interfaces/dhl/dhl.req.header';
import * as moment from "moment";
const dhlKey = require('../../config/dhl/key.config.json');
@Injectable()
export class LabelService {
    constructor(
        @InjectRepository(TokenEntity) private readonly tokenRepository: Repository<TokenEntity>,
        @Inject(HttpUtil) private readonly httpUtil: HttpUtil
    ) {}
    async LabelTheDelivery(_body: DhlLabelReqBody) {
        const token: TokenEntity | undefined = await this.tokenRepository.findOne();
        if (!token) {
            throw new HttpException('token配置不存在', 404);
        }
        const params: DhlLabelReqBody = {
            customerAccountId: undefined,
            pickupAccountId: dhlKey.PICKUPAccount,
            soldToAccountId: dhlKey.SOLDTOAccount,
            pickupDateTime: moment(new Date()).utcOffset('+08:00').format(),
            inlineLabelReturn: 'Y',
            handoverMethod: undefined,
            pickupAddress: _body.pickupAddress,
            shipperAddress: _body.shipperAddress,
            shipmentItems: _body.shipmentItems,
            label: _body.label
        };
        const header: DhlReqHeader = {
            messageType: 'LABEL',
            messageDateTime: moment(new Date()).utcOffset('+08:00').format(),
            accessToken: token.token,
            messageLanguage: 'en',
            messageVersion: '1.4'
        };
        const body = {labelRequest : { hdr: header, bd: params}};
        const result = await this.httpUtil.dhlPost(`${dhlApi.test}${dhlApi.label}`, body);
    }
}