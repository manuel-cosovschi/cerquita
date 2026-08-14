import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { EventsModule } from './modules/events/events.module';
import { PlatformConfigModule } from './modules/config/config.module';
import { ProvidersModule } from './providers/providers.module';
import { GeoModule } from './modules/geo/geo.module';
import { ListingsModule } from './modules/listings/listings.module';
import { AuctionsModule } from './modules/auctions/auctions.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { SearchModule } from './modules/search/search.module';
import { SocialModule } from './modules/social/social.module';
import { OffersModule } from './modules/offers/offers.module';
import { ChatModule } from './modules/chat/chat.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { UsersModule } from './modules/users/users.module';
import { StoresModule } from './modules/stores/stores.module';
import { HealthController } from './modules/health/health.controller';
import { RequestIdMiddleware } from './common/request-id.middleware';

/**
 * Modular monolith (spec §4).
 *
 * Domain modules are independent and talk to each other through the event bus
 * rather than direct imports wherever that is practical, so any one of them
 * could be lifted into its own service later without a rewrite. What this
 * deliberately is NOT is a set of microservices on day one.
 *
 * `JwtAuthGuard` is registered globally: routes are authenticated by default and
 * must opt out with `@Public()` or `@OptionalAuth()`. Forgetting a decorator
 * therefore fails closed.
 */
@Module({
  imports: [
    PrismaModule,
    EventsModule,
    PlatformConfigModule,
    ProvidersModule,
    AuthModule,
    GeoModule,
    ListingsModule,
    SearchModule,
    SocialModule,
    OffersModule,
    AuctionsModule,
    CheckoutModule,
    UsersModule,
    StoresModule,
    ReviewsModule,
    FavoritesModule,
    NotificationsModule,
    ChatModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
