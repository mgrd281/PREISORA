import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import type {
  OptimizationResultDto,
  ShoppingListDto,
  ShoppingListItemDto,
  ShoppingListPageDto,
} from '../../common/api/schemas';
import { ReqContext } from '../../common/context/req-context.decorator';
import { RequestContext } from '../../common/context/request-context';
import { wholePage } from '../../common/pagination/page';
import { ParseUuidPipe } from '../../common/validation/uuid.pipe';
import { AppConfigService } from '../../config/app-config.service';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptimizerService } from '../optimizer/optimizer.service';
import {
  OptimizeDto,
  ShoppingListCreateDto,
  ShoppingListItemCreateDto,
  ShoppingListItemUpdateDto,
  ShoppingListUpdateDto,
} from './shopping-lists.dto';
import { ShoppingListsService } from './shopping-lists.service';

@Controller('shopping-lists')
@UseGuards(JwtAuthGuard)
export class ShoppingListsController {
  constructor(
    private readonly lists: ShoppingListsService,
    private readonly optimizer: OptimizerService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  async listShoppingLists(@CurrentUserId() userId: string): Promise<ShoppingListPageDto> {
    return wholePage(await this.lists.listForUser(userId));
  }

  @Post()
  @HttpCode(201)
  createShoppingList(
    @CurrentUserId() userId: string,
    @Body() body: ShoppingListCreateDto,
  ): Promise<ShoppingListDto> {
    return this.lists.create(userId, body.name);
  }

  @Get(':listId')
  getShoppingListById(
    @CurrentUserId() userId: string,
    @Param('listId', ParseUuidPipe) listId: string,
  ): Promise<ShoppingListDto> {
    return this.lists.getById(userId, listId);
  }

  @Patch(':listId')
  updateShoppingList(
    @CurrentUserId() userId: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Body() body: ShoppingListUpdateDto,
  ): Promise<ShoppingListDto> {
    return this.lists.update(userId, listId, body.name);
  }

  @Delete(':listId')
  @HttpCode(204)
  deleteShoppingList(
    @CurrentUserId() userId: string,
    @Param('listId', ParseUuidPipe) listId: string,
  ): Promise<void> {
    return this.lists.remove(userId, listId);
  }

  @Post(':listId/items')
  async addShoppingListItem(
    @CurrentUserId() userId: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Body() body: ShoppingListItemCreateDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ShoppingListItemDto> {
    const { item, created } = await this.lists.addItem(userId, listId, body);
    // Natural-key idempotency: 201 on first add, 200 when it was already there.
    res.status(created ? 201 : 200);
    return item;
  }

  @Patch(':listId/items/:itemId')
  updateShoppingListItem(
    @CurrentUserId() userId: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Param('itemId', ParseUuidPipe) itemId: string,
    @Body() body: ShoppingListItemUpdateDto,
  ): Promise<ShoppingListItemDto> {
    return this.lists.updateItem(userId, listId, itemId, body);
  }

  @Delete(':listId/items/:itemId')
  @HttpCode(204)
  removeShoppingListItem(
    @CurrentUserId() userId: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Param('itemId', ParseUuidPipe) itemId: string,
  ): Promise<void> {
    return this.lists.removeItem(userId, listId, itemId);
  }

  @Post(':listId/optimize')
  @HttpCode(200)
  async optimizeShoppingList(
    @CurrentUserId() userId: string,
    @Param('listId', ParseUuidPipe) listId: string,
    @Body() body: OptimizeDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<OptimizationResultDto> {
    const items = await this.lists.itemsForOptimizer(userId, listId);
    return this.optimizer.optimizeList(items, {
      strategy: body.strategy ?? 'cheapest_total',
      lat: body.lat,
      lng: body.lng,
      radiusMeters: body.radiusMeters ?? this.config.pricing.defaultRadiusMeters,
      fallbackCurrencyCode: ctx.currencyCode,
    });
  }
}
