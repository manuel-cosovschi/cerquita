import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { UserAwareThrottlerGuard } from './common/throttler';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { UsersModule } from './modules/users/users.module';
import { StoresModule } from './modules/stores/stores.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AdminModule } from './modules/admin/admin.module';
import { MatchingModule } from './modules/matching/matching.module';
import { CommentsModule } from './modules/comments/comments.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { FeedModule } from './modules/feed/feed.module';
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
    /*
     * Rate limiting (spec §95). Three windows rather than one: a burst of
     * clicks is normal, a steady stream for a minute is a script, and an hour
     * of it is abuse. The strictest one that a caller trips is the one that
     * stops them.
     *
     * Storage is in-process. Behind more than one API instance each would
     * count separately, so a distributed store is the change to make when the
     * monolith is first replicated — not a reason to skip limiting now.
     */
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 20 },
      { name: 'medium', ttl: 60_000, limit: 200 },
      { name: 'long', ttl: 3_600_000, limit: 3_000 },
    ]),
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
    ReservationsModule,
    ReportsModule,
    AdminModule,
    MatchingModule,
    CommentsModule,
    UploadsModule,
    CategoriesModule,
    FeedModule,
    ReviewsModule,
    FavoritesModule,
    NotificationsModule,
    ChatModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: the throttler runs BEFORE authentication so an unauthenticated
    // flood is rejected without touching the database, and `getTracker` still sees
    // `request.user` on routes the JWT guard has already resolved in a prior request.
    { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
