insert into assets (symbol, precision) values
('USD', 2),
('UZS', 2)
on conflict do nothing;

insert into trading_pairs (symbol, base_asset_id, quote_asset_id, price_precision, qty_precision, min_qty, min_notional, status)
select 'UZS-USD', b.id, q.id, 8, 2, 1, 0.01, 'active'
from assets b join assets q on b.symbol='UZS' and q.symbol='USD'
on conflict do nothing;
