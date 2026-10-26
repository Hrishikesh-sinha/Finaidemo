import { Receipt, UtensilsCrossed, Car, ShoppingBag, Ticket, CircleDot } from 'lucide-react';
import { categoryColor } from '../ui/theme';

/**
 * Each category keeps one colour and one icon everywhere it appears, so it can
 * be recognised by shape before the label is read. The icon is the secondary
 * encoding that keeps identity from resting on colour alone.
 */
const CATEGORY_ICON: Record<string, typeof Receipt> = {
  Bills: Receipt,
  Food: UtensilsCrossed,
  Transport: Car,
  Shopping: ShoppingBag,
  Entertainment: Ticket
};

export function categoryIcon(name: string) {
  return CATEGORY_ICON[name] ?? CircleDot;
}

export function CategoryBadge({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const Icon = categoryIcon(name);
  const color = categoryColor(name);
  const box = size === 'sm' ? 'w-5 h-5' : 'w-8 h-8';
  const glyph = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${box} rounded-full inline-flex items-center justify-center shrink-0`}
      style={{ backgroundColor: `${color}2E`, color }}
      aria-hidden="true"
    >
      <Icon className={glyph} strokeWidth={2} />
    </span>
  );
}
