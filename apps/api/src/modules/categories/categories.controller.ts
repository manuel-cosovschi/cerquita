import { Controller, Get } from '@nestjs/common';
import type { Category } from '@cerquita/types';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/jwt-auth.guard';

/**
 * The category tree.
 *
 * Public and flat: every category in one response, parents identified by
 * `parentId`, because the whole tree is a few dozen rows and the publish form
 * needs all of it at once to render a picker. Paginating it would only make
 * that form do three round trips to show one list.
 */
@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async list(): Promise<Category[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, icon: true, parentId: true },
    });

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      icon: row.icon ?? undefined,
      parentId: row.parentId ?? undefined,
    }));
  }
}
