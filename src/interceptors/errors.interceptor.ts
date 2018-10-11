import { ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class ErrorsInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, calls$: Observable<any>): Observable<any> {
        return calls$.pipe(catchError((error, caught) => {
            if (error instanceof HttpException) {
                return Promise.resolve({
                    code: error.getStatus(),
                    message: error.getResponse()
                });
            } else {
                return Promise.resolve({
                    code: 500,
                    message: '出现了意外错误：' + error.toString()
                });
            }
        }));
    }
}