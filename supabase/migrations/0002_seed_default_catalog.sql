-- =============================================================================
-- Seed default catalog.
--
-- Idempotent: only inserts rows that don't already exist by name.
-- Run after 0001_init.sql in the SQL editor.
-- =============================================================================

insert into public.products (
  name, category, buying_price, selling_price, unit,
  opening_stock, minimum_stock, status
) values
  ('Castle Lager 375ml', 'Beer',         7.50, 12.00, 'bottle', 0, 24, 'active'),
  ('Black Label 375ml',  'Beer',         8.50, 14.00, 'bottle', 0, 24, 'active'),
  ('Coke 500ml',         'Soft Drinks',  3.50,  6.00, 'bottle', 0, 24, 'active'),
  ('Sprite 500ml',       'Soft Drinks',  3.50,  6.00, 'bottle', 0, 12, 'active'),
  ('Fanta Orange 500ml', 'Soft Drinks',  3.50,  6.00, 'bottle', 0, 12, 'active'),
  ('Mineral Water 500ml','Water',        2.00,  4.00, 'bottle', 0, 24, 'active'),
  ('Mineral Water 1L',   'Water',        3.50,  6.00, 'bottle', 0, 12, 'active'),
  ('Soda 1L',            'Soft Drinks',  4.50,  8.00, 'bottle', 0, 12, 'active')
on conflict (name) do nothing;
