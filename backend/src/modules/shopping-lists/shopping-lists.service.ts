import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { ShoppingListDto, ShoppingListItemDto } from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { DATABASE, Database } from '../../database/database.module';
import { shoppingListItems, shoppingLists } from '../../database/schema';
import { ProductsService } from '../products/products.service';

interface ListRow {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ItemRow {
  id: string;
  listId: string;
  productId: string;
  quantity: number;
  note: string | null;
}

function toItemDto(row: ItemRow): ShoppingListItemDto {
  return {
    id: row.id,
    productId: row.productId,
    quantity: row.quantity,
    note: row.note,
  };
}

function toListDto(list: ListRow, items: ItemRow[]): ShoppingListDto {
  return {
    id: list.id,
    name: list.name,
    items: items.map(toItemDto),
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  };
}

@Injectable()
export class ShoppingListsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly products: ProductsService,
  ) {}

  /** Ownership check and existence check are the same lookup — never leaked apart. */
  private async requireList(userId: string, listId: string): Promise<ListRow> {
    const [row] = await this.db
      .select({
        id: shoppingLists.id,
        name: shoppingLists.name,
        createdAt: shoppingLists.createdAt,
        updatedAt: shoppingLists.updatedAt,
      })
      .from(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
      .limit(1);
    if (!row) throw AppException.resourceNotFound('shopping_list');
    return row;
  }

  private async itemsOf(listIds: string[]): Promise<ItemRow[]> {
    if (listIds.length === 0) return [];
    return this.db
      .select({
        id: shoppingListItems.id,
        listId: shoppingListItems.listId,
        productId: shoppingListItems.productId,
        quantity: shoppingListItems.quantity,
        note: shoppingListItems.note,
      })
      .from(shoppingListItems)
      .where(inArray(shoppingListItems.listId, listIds))
      .orderBy(asc(shoppingListItems.createdAt));
  }

  async listForUser(userId: string): Promise<ShoppingListDto[]> {
    const lists = await this.db
      .select({
        id: shoppingLists.id,
        name: shoppingLists.name,
        createdAt: shoppingLists.createdAt,
        updatedAt: shoppingLists.updatedAt,
      })
      .from(shoppingLists)
      .where(eq(shoppingLists.userId, userId))
      .orderBy(desc(shoppingLists.updatedAt));

    const items = await this.itemsOf(lists.map((l) => l.id));
    return lists.map((list) => toListDto(list, items.filter((i) => i.listId === list.id)));
  }

  async getById(userId: string, listId: string): Promise<ShoppingListDto> {
    const list = await this.requireList(userId, listId);
    const items = await this.itemsOf([list.id]);
    return toListDto(list, items);
  }

  async create(userId: string, name: string): Promise<ShoppingListDto> {
    const [row] = await this.db
      .insert(shoppingLists)
      .values({ userId, name })
      .returning({
        id: shoppingLists.id,
        name: shoppingLists.name,
        createdAt: shoppingLists.createdAt,
        updatedAt: shoppingLists.updatedAt,
      });
    return toListDto(row, []);
  }

  async update(userId: string, listId: string, name: string | undefined): Promise<ShoppingListDto> {
    await this.requireList(userId, listId);
    if (name !== undefined) {
      await this.db
        .update(shoppingLists)
        .set({ name, updatedAt: new Date() })
        .where(eq(shoppingLists.id, listId));
    }
    return this.getById(userId, listId);
  }

  /** DELETE is always idempotent (CONVENTIONS.md): an absent list still answers 204. */
  async remove(userId: string, listId: string): Promise<void> {
    await this.db
      .delete(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)));
  }

  /**
   * Natural-key idempotent on (list, product): re-adding returns the EXISTING item
   * with 200 and does not bump the quantity.
   */
  async addItem(
    userId: string,
    listId: string,
    input: { productId: string; quantity?: number; note?: string | null },
  ): Promise<{ item: ShoppingListItemDto; created: boolean }> {
    await this.requireList(userId, listId);
    await this.products.assertExists(input.productId);

    const [existing] = await this.db
      .select({
        id: shoppingListItems.id,
        listId: shoppingListItems.listId,
        productId: shoppingListItems.productId,
        quantity: shoppingListItems.quantity,
        note: shoppingListItems.note,
      })
      .from(shoppingListItems)
      .where(
        and(eq(shoppingListItems.listId, listId), eq(shoppingListItems.productId, input.productId)),
      )
      .limit(1);

    if (existing) return { item: toItemDto(existing), created: false };

    const [row] = await this.db
      .insert(shoppingListItems)
      .values({
        listId,
        productId: input.productId,
        quantity: input.quantity ?? 1,
        note: input.note ?? null,
      })
      .returning({
        id: shoppingListItems.id,
        listId: shoppingListItems.listId,
        productId: shoppingListItems.productId,
        quantity: shoppingListItems.quantity,
        note: shoppingListItems.note,
      });

    await this.touch(listId);
    return { item: toItemDto(row), created: true };
  }

  async updateItem(
    userId: string,
    listId: string,
    itemId: string,
    patch: { quantity?: number; note?: string | null },
  ): Promise<ShoppingListItemDto> {
    await this.requireList(userId, listId);

    const update: Partial<{ quantity: number; note: string | null }> = {};
    if (patch.quantity !== undefined) update.quantity = patch.quantity;
    if (patch.note !== undefined) update.note = patch.note;

    const rows =
      Object.keys(update).length > 0
        ? await this.db
            .update(shoppingListItems)
            .set(update)
            .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)))
            .returning({
              id: shoppingListItems.id,
              listId: shoppingListItems.listId,
              productId: shoppingListItems.productId,
              quantity: shoppingListItems.quantity,
              note: shoppingListItems.note,
            })
        : await this.db
            .select({
              id: shoppingListItems.id,
              listId: shoppingListItems.listId,
              productId: shoppingListItems.productId,
              quantity: shoppingListItems.quantity,
              note: shoppingListItems.note,
            })
            .from(shoppingListItems)
            .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)))
            .limit(1);

    if (rows.length === 0) throw AppException.resourceNotFound('shopping_list_item');
    await this.touch(listId);
    return toItemDto(rows[0]);
  }

  /** Idempotent for the ITEM; an unknown LIST still answers 404 (contract). */
  async removeItem(userId: string, listId: string, itemId: string): Promise<void> {
    await this.requireList(userId, listId);
    await this.db
      .delete(shoppingListItems)
      .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)));
    await this.touch(listId);
  }

  /** Items for the optimizer, after the ownership check. */
  async itemsForOptimizer(
    userId: string,
    listId: string,
  ): Promise<Array<{ productId: string; quantity: number }>> {
    await this.requireList(userId, listId);
    const items = await this.itemsOf([listId]);
    return items.map((item) => ({ productId: item.productId, quantity: item.quantity }));
  }

  private async touch(listId: string): Promise<void> {
    await this.db
      .update(shoppingLists)
      .set({ updatedAt: new Date() })
      .where(eq(shoppingLists.id, listId));
  }
}
