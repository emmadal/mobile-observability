import { type BreadcrumbInput, LIMITS } from '@mobile-observability/protocol';

/** Fixed-size ring of the most recent breadcrumbs, attached to errors. */
export class BreadcrumbBuffer {
  private readonly items: BreadcrumbInput[] = [];

  constructor(private readonly capacity: number = LIMITS.maxBreadcrumbs) {}

  add(breadcrumb: BreadcrumbInput): void {
    this.items.push(breadcrumb);
    if (this.items.length > this.capacity) this.items.shift();
  }

  snapshot(limit = this.capacity): BreadcrumbInput[] {
    return this.items.slice(-limit);
  }

  clear(): void {
    this.items.length = 0;
  }
}
