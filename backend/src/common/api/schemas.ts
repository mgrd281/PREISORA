/**
 * Contract-typed aliases over `src/generated/api-types.ts` (generated from
 * `api-contract/dist/openapi.bundled.json` by `openapi-typescript`).
 *
 * Every response mapper in this codebase declares its return type here, so a
 * contract change that the backend has not followed becomes a COMPILE error rather
 * than a silent wire-shape drift (ADR-0003 "conformance is actively wired").
 * Database rows are never serialized directly — internal keys never leak.
 */
import type { components, operations } from '../../generated/api-types';

export type Schemas = components['schemas'];

export type ErrorDto = Schemas['Error'];
export type MoneyDto = Schemas['Money'];
export type ImageAssetDto = Schemas['ImageAsset'];
export type ProductDto = Schemas['Product'];
export type ProductPageDto = Schemas['ProductPage'];
export type PromotionDto = Schemas['Promotion'];
export type StoreDto = Schemas['Store'];
export type StorePageDto = Schemas['StorePage'];
export type OfferDto = Schemas['Offer'];
export type OfferPageDto = Schemas['OfferPage'];
export type PageInfoDto = Schemas['PageInfo'];
export type PriceHistoryDto = Schemas['PriceHistory'];
export type RetailerDto = Schemas['Retailer'];
export type RetailerMarketDto = Schemas['RetailerMarket'];
export type RetailerWithMarketsDto = Schemas['RetailerWithMarkets'];
export type RetailerPageDto = Schemas['RetailerPage'];
export type AuthTokensDto = Schemas['AuthTokens'];
export type UserDto = Schemas['User'];
export type UserIdentityDto = Schemas['UserIdentity'];
export type DeviceDto = Schemas['Device'];
export type FavoriteDto = Schemas['Favorite'];
export type FavoritePageDto = Schemas['FavoritePage'];
export type GeoPointDto = Schemas['GeoPoint'];
export type LocationDto = Schemas['Location'];
export type PriceAlertDto = Schemas['PriceAlert'];
export type PriceAlertPageDto = Schemas['PriceAlertPage'];
export type ShoppingListDto = Schemas['ShoppingList'];
export type ShoppingListItemDto = Schemas['ShoppingListItem'];
export type ShoppingListPageDto = Schemas['ShoppingListPage'];
export type OptimizationResultDto = Schemas['OptimizationResult'];
export type CapabilitiesDto = Schemas['Capabilities'];

/** Request-body shapes, used to keep the validated DTO classes honest. */
export type RegisterRequestDto = Schemas['RegisterRequest'];
export type LoginRequestDto = Schemas['LoginRequest'];
export type RefreshRequestDto = Schemas['RefreshRequest'];
export type OAuthExchangeRequestDto = Schemas['OAuthExchangeRequest'];
export type IdentityLinkRequestDto = Schemas['IdentityLinkRequest'];
export type UserUpdateRequestDto = Schemas['UserUpdateRequest'];
export type DeviceRegisterRequestDto = Schemas['DeviceRegisterRequest'];
export type DeviceUpdateRequestDto = Schemas['DeviceUpdateRequest'];
export type FavoriteCreateRequestDto = Schemas['FavoriteCreateRequest'];
export type AlertCreateRequestDto = Schemas['AlertCreateRequest'];
export type AlertUpdateRequestDto = Schemas['AlertUpdateRequest'];
export type ShoppingListCreateRequestDto = Schemas['ShoppingListCreateRequest'];
export type ShoppingListUpdateRequestDto = Schemas['ShoppingListUpdateRequest'];
export type ShoppingListItemCreateRequestDto = Schemas['ShoppingListItemCreateRequest'];
export type ShoppingListItemUpdateRequestDto = Schemas['ShoppingListItemUpdateRequest'];
export type OptimizeRequestDto = Schemas['OptimizeRequest'];

/** `GET /health` has an inline response schema; pull it out of the operation type. */
export type HealthDto = operations['getHealth']['responses']['200']['content']['application/json'];

/** Convenience aliases for the inline sub-objects of OptimizationResult. */
export type OptimizationStoreDto = OptimizationResultDto['stores'][number];
export type OptimizationStoreItemDto = OptimizationStoreDto['items'][number];
export type UnavailableItemDto = OptimizationResultDto['unavailableItems'][number];
export type PriceHistoryPointDto = PriceHistoryDto['points'][number];
export type StoreAddressDto = StoreDto['address'];
export type OpeningHourDto = NonNullable<StoreDto['openingHours']>[number];

/**
 * Compile-time assertion helper: `satisfies`-style check that a runtime DTO class or
 * literal still matches the contract-generated type.
 */
export type Conforms<TContract, TActual extends TContract> = TActual;

/**
 * `openapi-typescript` renders a property with a `default` as REQUIRED (the server
 * always sends it back), but the corresponding REQUEST field is optional for the
 * caller. This helper marks exactly those fields optional so a request DTO class can
 * still `implements` its contract type and keep every other field checked.
 */
export type WithOptionalDefaults<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
