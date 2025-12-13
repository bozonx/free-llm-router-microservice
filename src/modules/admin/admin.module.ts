
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { StateModule } from '../state/state.module.js';

@Module({
    imports: [StateModule],
    controllers: [AdminController],
})
export class AdminModule { }
