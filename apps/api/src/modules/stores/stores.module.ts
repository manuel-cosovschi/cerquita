import { Module } from '@nestjs/common';
import { StoresService } from './stores.service';
import { ProductsService } from './products.service';
import { PromotionsService } from './promotions.service';
import { ProductsController, StoresController } from './stores.controller';

@Module({
  controllers: [StoresController, ProductsController],
  providers: [StoresService, ProductsService, PromotionsService],
  exports: [StoresService, ProductsService, PromotionsService],
})
export class StoresModule {}
