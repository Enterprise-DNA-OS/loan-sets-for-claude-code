-- Loan Sets for Claude Code: the schema.
-- Hospitals, surgeons, reps, products and lots, kit lists, loan sets and what is in them,
-- consignment and warehouse stock with par levels, surgical cases, the sets booked to each case,
-- usage captured from charge sheets, billing, and market actions (recalls) traced to every unit.
-- Plain Postgres. Runs the same on PGlite (embedded) and any Postgres 14+.
-- Dates are calendar dates. Money is whole cents in bigint.

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Monday to Friday count. Public holidays are not taken off: the check warns early, never late.
create or replace function add_working_days(start_on date, n int) returns date language plpgsql immutable as $$
declare
  d date := start_on;
  left_to_add int := n;
begin
  while left_to_add > 0 loop
    d := d + 1;
    if extract(isodow from d) < 6 then
      left_to_add := left_to_add - 1;
    end if;
  end loop;
  return d;
end
$$;

create table hospitals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  country text not null check (country in ('NZ', 'AU')),
  sector text not null default 'private' check (sector in ('public', 'private')),
  loan_lead_hours int not null default 48 check (loan_lead_hours >= 0),
  return_days int not null default 3 check (return_days >= 0),
  theatre_contact text not null default '',
  theatre_email text not null default '',
  accounts_email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table surgeons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  specialty text not null default '',
  hospital_id uuid references hospitals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table reps (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  region text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  description text not null,
  kind text not null default 'implant' check (kind in ('implant', 'instrument', 'consumable')),
  track text not null default 'lot' check (track in ('lot', 'serial', 'none')),
  card_required boolean not null default false,
  price_cents bigint not null default 0 check (price_cents >= 0),
  artg_no text not null default '',
  billing_code text not null default '',
  first_supplied_nz_on date,
  wand_notified_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  lot_no text not null,
  expires_on date,
  created_at timestamptz not null default now(),
  unique (product_id, lot_no)
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('warehouse', 'consignment', 'trunk', 'quarantine')),
  country text not null check (country in ('NZ', 'AU')),
  hospital_id uuid references hospitals(id),
  rep_id uuid references reps(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table stock (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  product_id uuid not null references products(id),
  lot_id uuid references lots(id),
  qty int not null check (qty >= 0),
  last_moved_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index stock_key on stock (location_id, product_id, coalesce(lot_id::text, ''));

create table pars (
  location_id uuid not null references locations(id),
  product_id uuid not null references products(id),
  par int not null check (par >= 0),
  primary key (location_id, product_id)
);

-- A kit list: what a loan set of this type should hold.
create table kits (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  specialty text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table kit_lines (
  kit_id uuid not null references kits(id),
  product_id uuid not null references products(id),
  qty int not null check (qty > 0),
  primary key (kit_id, product_id)
);

create table sets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kit_id uuid not null references kits(id),
  home_location_id uuid references locations(id),
  status text not null default 'available' check (status in ('available', 'in_transit', 'at_hospital', 'returned', 'quarantine', 'retired')),
  hospital_id uuid references hospitals(id),
  turnaround_days int not null default 3 check (turnaround_days >= 0),
  last_checked_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table set_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references sets(id),
  product_id uuid not null references products(id),
  lot_id uuid references lots(id),
  qty int not null check (qty >= 0)
);
create unique index set_items_key on set_items (set_id, product_id, coalesce(lot_id::text, ''));

create table cases (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  hospital_id uuid not null references hospitals(id),
  surgeon_id uuid references surgeons(id),
  rep_id uuid references reps(id),
  procedure text not null default '',
  surgery_on date not null,
  status text not null default 'booked' check (status in ('booked', 'confirmed', 'done', 'cancelled')),
  patient_ref text not null default '',
  po_number text not null default '',
  charge_sheet_on date,
  billed_on date,
  invoice_no text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table case_sets (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id),
  set_id uuid not null references sets(id),
  shipped_on date,
  delivered_at timestamp,
  returned_on date,
  created_at timestamptz not null default now(),
  unique (case_id, set_id)
);

create table usage (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id),
  product_id uuid not null references products(id),
  lot_id uuid references lots(id),
  serial_no text not null default '',
  qty int not null default 1 check (qty > 0),
  source text not null default 'set' check (source in ('set', 'consignment', 'trunk')),
  location_id uuid references locations(id),
  set_id uuid references sets(id),
  implant_card_given boolean not null default false,
  price_cents bigint not null default 0,
  created_at timestamptz not null default now()
);

-- Recalls, product alerts and corrections. lot_id empty means every lot of the product.
create table market_actions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  product_id uuid not null references products(id),
  lot_id uuid references lots(id),
  kind text not null default 'recall' check (kind in ('recall', 'product_alert', 'product_correction', 'hazard_alert')),
  country text not null check (country in ('NZ', 'AU', 'both')),
  notified_on date not null default current_date,
  reason text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  hospital_id uuid references hospitals(id),
  kind text not null default 'note' check (kind in ('call', 'email', 'visit', 'meeting', 'note')),
  body text not null,
  actor text not null default '',
  noted_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  entity text not null,
  record_id text not null,
  operation text not null,
  actor text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  filename text not null,
  fingerprint text not null unique,
  row_count int not null,
  actor text not null,
  created_at timestamptz not null default now()
);

create trigger hospitals_touch before update on hospitals for each row execute function touch_updated_at();
create trigger surgeons_touch before update on surgeons for each row execute function touch_updated_at();
create trigger reps_touch before update on reps for each row execute function touch_updated_at();
create trigger products_touch before update on products for each row execute function touch_updated_at();
create trigger locations_touch before update on locations for each row execute function touch_updated_at();
create trigger stock_touch before update on stock for each row execute function touch_updated_at();
create trigger kits_touch before update on kits for each row execute function touch_updated_at();
create trigger sets_touch before update on sets for each row execute function touch_updated_at();
create trigger cases_touch before update on cases for each row execute function touch_updated_at();
create trigger market_actions_touch before update on market_actions for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- views

-- Each set against its kit list: what is missing.
create view set_shortfalls as
select s.code as set_code, k.code as kit, p.sku, p.description, kl.qty as kit_qty,
       coalesce(sum(si.qty), 0)::int as in_set, (kl.qty - coalesce(sum(si.qty), 0))::int as short
from sets s
join kits k on k.id = s.kit_id
join kit_lines kl on kl.kit_id = s.kit_id
join products p on p.id = kl.product_id
left join set_items si on si.set_id = s.id and si.product_id = kl.product_id
where s.status <> 'retired'
group by s.code, k.code, p.sku, p.description, kl.qty
having kl.qty - coalesce(sum(si.qty), 0) > 0;

-- Live cases: booked or confirmed and not yet past.
create view live_cases as
select c.*, h.code as hospital, h.name as hospital_name, h.country, h.sector, h.loan_lead_hours,
       sg.name as surgeon, r.name as rep
from cases c
join hospitals h on h.id = c.hospital_id
left join surgeons sg on sg.id = c.surgeon_id
left join reps r on r.id = c.rep_id
where c.status in ('booked', 'confirmed');

-- One row per set booked to a coming case, with the hospital's delivery deadline.
-- Theatre lists start about 07:00, so a set is due loan_lead_hours before 07:00 on the day.
create view case_set_checks as
select lc.code as case_code, lc.surgery_on, lc.hospital, lc.rep, s.code as set_code, cs.shipped_on, cs.delivered_at,
       (lc.surgery_on::timestamp + interval '7 hours' - make_interval(hours => lc.loan_lead_hours)) as deliver_by,
       (select coalesce(sum(short), 0)::int from set_shortfalls f where f.set_code = s.code) as items_short,
       (select coalesce(sum(si.qty), 0)::int from set_items si join lots l on l.id = si.lot_id
         where si.set_id = s.id and si.qty > 0 and l.expires_on is not null and l.expires_on <= lc.surgery_on) as items_expiring,
       (select string_agg(o.code, ', ' order by o.code) from case_sets cs2 join cases o on o.id = cs2.case_id
         where cs2.set_id = s.id and o.id <> lc.id and o.status in ('booked', 'confirmed')
           and abs(o.surgery_on - lc.surgery_on) < s.turnaround_days) as clashes_with
from live_cases lc
join case_sets cs on cs.case_id = lc.id
join sets s on s.id = cs.set_id
where lc.surgery_on >= current_date;

create view case_readiness as
select lc.code, lc.surgery_on, lc.surgery_on - current_date as days_to_go, lc.hospital, lc.surgeon, lc.rep, lc.procedure, lc.status,
       (select count(*)::int from case_sets cs where cs.case_id = lc.id) as sets,
       (select count(*)::int from case_sets cs where cs.case_id = lc.id and cs.delivered_at is not null) as delivered,
       coalesce((
         select string_agg(issue, '; ' order by issue) from (
           select c.set_code || ': ' || case
                    when c.delivered_at is null and localtimestamp > c.deliver_by then 'not delivered, was due ' || to_char(c.deliver_by, 'YYYY-MM-DD HH24:MI')
                    else 'deliver by ' || to_char(c.deliver_by, 'YYYY-MM-DD HH24:MI') end as issue
           from case_set_checks c where c.case_code = lc.code and c.delivered_at is null and localtimestamp > c.deliver_by - interval '24 hours'
           union all
           select c.set_code || ': ' || c.items_short || ' item(s) short of kit list' from case_set_checks c where c.case_code = lc.code and c.items_short > 0
           union all
           select c.set_code || ': ' || c.items_expiring || ' item(s) expire before surgery' from case_set_checks c where c.case_code = lc.code and c.items_expiring > 0
           union all
           select c.set_code || ': also booked on ' || c.clashes_with from case_set_checks c where c.case_code = lc.code and c.clashes_with is not null
           union all
           select 'no set booked' where not exists (select 1 from case_sets cs where cs.case_id = lc.id)
         ) i
       ), 'ok') as issue
from live_cases lc
where lc.surgery_on between current_date and current_date + 14;

create view set_board as
select s.code, k.name as kit, s.status, h.code as at_hospital, hl.code as home,
       (select min(c.surgery_on) from case_sets cs join cases c on c.id = cs.case_id
         where cs.set_id = s.id and c.status in ('booked', 'confirmed') and c.surgery_on >= current_date) as next_case_on,
       (select max(c.surgery_on) from case_sets cs join cases c on c.id = cs.case_id
         where cs.set_id = s.id and c.status = 'done') as last_used_on,
       (select coalesce(sum(short), 0)::int from set_shortfalls f where f.set_code = s.code) as items_short,
       s.last_checked_on
from sets s
join kits k on k.id = s.kit_id
left join hospitals h on h.id = s.hospital_id
left join locations hl on hl.id = s.home_location_id
where s.status <> 'retired';

-- Sets still out after the case, past the hospital's return days.
create view overdue_returns as
select s.code as set_code, c.code as case_code, h.code as hospital, h.name as hospital_name, c.surgery_on,
       current_date - c.surgery_on as days_out, h.return_days, r.name as rep
from case_sets cs
join cases c on c.id = cs.case_id
join sets s on s.id = cs.set_id
join hospitals h on h.id = c.hospital_id
left join reps r on r.id = c.rep_id
where cs.shipped_on is not null and cs.returned_on is null
  and c.status <> 'cancelled' and c.surgery_on < current_date
  and current_date - c.surgery_on > h.return_days;

create view case_value as
select c.id, c.code, coalesce(sum(u.qty * u.price_cents), 0)::bigint as value_cents, count(u.id)::int as lines
from cases c left join usage u on u.case_id = c.id
group by c.id, c.code;

-- Order to cash: surgery done, money not yet invoiced.
create view unbilled_cases as
select c.code, c.surgery_on, current_date - c.surgery_on as days_since, h.code as hospital, h.sector, r.name as rep,
       v.lines as usage_lines, v.value_cents, c.po_number,
       case when v.lines = 0 then 'no usage recorded: chase the charge sheet'
            when h.sector = 'private' and c.po_number = '' then 'usage in, no purchase order'
            else 'ready to invoice' end as issue
from cases c
join hospitals h on h.id = c.hospital_id
left join reps r on r.id = c.rep_id
join case_value v on v.id = c.id
where c.status <> 'cancelled' and c.billed_on is null and c.surgery_on < current_date;

create view consignment_check as
select l.code as location, l.name as location_name, p.sku, p.description, pa.par,
       coalesce((select sum(st.qty) from stock st where st.location_id = l.id and st.product_id = p.id), 0)::int as on_hand,
       greatest(pa.par - coalesce((select sum(st.qty) from stock st where st.location_id = l.id and st.product_id = p.id), 0), 0)::int as to_replenish
from pars pa
join locations l on l.id = pa.location_id
join products p on p.id = pa.product_id;

-- Stock sitting in the field that has not moved: working capital parked at a hospital.
create view slow_stock as
select l.code as location, l.kind, p.sku, p.description, lo.lot_no, st.qty, st.last_moved_on,
       current_date - st.last_moved_on as days_still, (st.qty * p.price_cents)::bigint as value_cents
from stock st
join locations l on l.id = st.location_id
join products p on p.id = st.product_id
left join lots lo on lo.id = st.lot_id
where st.qty > 0 and l.kind in ('consignment', 'trunk') and st.last_moved_on < current_date - 180;

-- Every lot within 90 days of expiry, wherever it sits: stock or a loan set.
create view expiring as
select 'stock' as held_in, l.code as place, p.sku, lo.lot_no, lo.expires_on, lo.expires_on - current_date as days_left, st.qty
from stock st join lots lo on lo.id = st.lot_id join products p on p.id = st.product_id join locations l on l.id = st.location_id
where st.qty > 0 and lo.expires_on <= current_date + 90
union all
select 'set', s.code, p.sku, lo.lot_no, lo.expires_on, lo.expires_on - current_date, si.qty
from set_items si join lots lo on lo.id = si.lot_id join products p on p.id = si.product_id join sets s on s.id = si.set_id
where si.qty > 0 and lo.expires_on <= current_date + 90 and s.status <> 'retired';

-- Where every affected unit of an open market action is: stock, loan sets, and patients' cases.
create view recall_trace as
select ma.code as action, ma.kind, p.sku, lo.lot_no, 'stock' as held_in, l.code as place, h.code as hospital, st.qty, null::text as case_code, null::date as surgery_on, null::text as patient_ref
from market_actions ma join products p on p.id = ma.product_id
join stock st on st.product_id = ma.product_id and (ma.lot_id is null or st.lot_id = ma.lot_id) and st.qty > 0
join locations l on l.id = st.location_id left join hospitals h on h.id = l.hospital_id left join lots lo on lo.id = st.lot_id
where ma.status = 'open' and l.kind <> 'quarantine'
union all
select ma.code, ma.kind, p.sku, lo.lot_no, 'set', s.code, h.code, si.qty, null, null, null
from market_actions ma join products p on p.id = ma.product_id
join set_items si on si.product_id = ma.product_id and (ma.lot_id is null or si.lot_id = ma.lot_id) and si.qty > 0
join sets s on s.id = si.set_id left join hospitals h on h.id = s.hospital_id left join lots lo on lo.id = si.lot_id
where ma.status = 'open' and s.status not in ('quarantine', 'retired')
union all
select ma.code, ma.kind, p.sku, lo.lot_no, 'patient', h.name, h.code, u.qty, c.code, c.surgery_on, c.patient_ref
from market_actions ma join products p on p.id = ma.product_id
join usage u on u.product_id = ma.product_id and (ma.lot_id is null or u.lot_id = ma.lot_id)
join cases c on c.id = u.case_id join hospitals h on h.id = c.hospital_id left join lots lo on lo.id = u.lot_id
where ma.status = 'open';

create view set_utilisation as
select s.code as set_code, k.name as kit,
       (select count(*)::int from case_sets cs join cases c on c.id = cs.case_id where cs.set_id = s.id and c.status = 'done' and c.surgery_on >= current_date - 90) as cases_90_days,
       (select count(*)::int from case_sets cs join cases c on c.id = cs.case_id where cs.set_id = s.id and c.status in ('booked', 'confirmed') and c.surgery_on >= current_date) as booked_ahead,
       (select max(c.surgery_on) from case_sets cs join cases c on c.id = cs.case_id where cs.set_id = s.id and c.status = 'done') as last_used_on
from sets s join kits k on k.id = s.kit_id
where s.status <> 'retired';

create view surgeon_usage as
select sg.name as surgeon, h.code as hospital, p.sku, p.description, sum(u.qty)::int as units, sum(u.qty * u.price_cents)::bigint as value_cents,
       count(distinct c.id)::int as cases
from usage u join cases c on c.id = u.case_id join products p on p.id = u.product_id
join hospitals h on h.id = c.hospital_id left join surgeons sg on sg.id = c.surgeon_id
where c.surgery_on >= current_date - 365
group by sg.name, h.code, p.sku, p.description;

create view rep_load as
select r.code, r.name, r.region,
       (select count(*)::int from cases c where c.rep_id = r.id and c.status in ('booked', 'confirmed') and c.surgery_on between current_date and current_date + 7) as cases_next_7_days,
       (select count(*)::int from case_readiness cr where cr.rep = r.name and cr.issue <> 'ok') as cases_with_issues,
       (select count(*)::int from overdue_returns o where o.rep = r.name) as overdue_returns,
       (select count(*)::int from unbilled_cases u where u.rep = r.name) as unbilled_cases
from reps r;

-- Compliance: records checked against the rules in docs/compliance.md.
create view compliance_findings as
-- R01: a device supplied in Australia has an ARTG entry on record.
select 'R01' as rule, p.sku as record, p.description || ': supplied in Australia with no ARTG number on record' as detail,
       null::date as due_on, null::int as days_left, 'Therapeutic Goods Act 1989 (Cth) s 41MI' as source
from products p
where p.kind <> 'instrument' and p.artg_no = '' and (
  exists (select 1 from stock st join locations l on l.id = st.location_id where st.product_id = p.id and st.qty > 0 and l.country = 'AU')
  or exists (select 1 from usage u join cases c on c.id = u.case_id join hospitals h on h.id = c.hospital_id where u.product_id = p.id and h.country = 'AU')
  or exists (select 1 from set_items si join case_sets cs on cs.set_id = si.set_id join cases c on c.id = cs.case_id join hospitals h on h.id = c.hospital_id
             where si.product_id = p.id and si.qty > 0 and h.country = 'AU' and c.status in ('booked', 'confirmed')))
union all
-- R02: a device first supplied in New Zealand is notified to WAND within 30 working days.
select 'R02', p.sku, p.description || ': first supplied in NZ ' || p.first_supplied_nz_on || ', no WAND notification on record',
       add_working_days(p.first_supplied_nz_on, 30), add_working_days(p.first_supplied_nz_on, 30) - current_date,
       'Medicines (Database of Medical Devices) Regulations 2003 (NZ) reg 6'
from products p
where p.first_supplied_nz_on is not null and p.wand_notified_on is null
  and add_working_days(p.first_supplied_nz_on, 30) <= current_date + 14
union all
-- R03: implant usage in Australia carries the lot or serial, so distribution records can trace it.
select 'R03', c.code, p.sku || ' used at ' || h.code || ' with no ' || p.track || ' number recorded', c.surgery_on, null,
       'Therapeutic Goods Act 1989 (Cth) s 41FO'
from usage u join cases c on c.id = u.case_id join products p on p.id = u.product_id join hospitals h on h.id = c.hospital_id
where h.country = 'AU' and p.kind = 'implant'
  and ((p.track = 'lot' and u.lot_id is null) or (p.track = 'serial' and u.serial_no = ''))
union all
-- R04: an implant that needs a patient implant card went with one.
select 'R04', c.code, p.sku || ' implanted at ' || h.code || ' with no implant card recorded', c.surgery_on, null,
       'Therapeutic Goods (Medical Devices) Regulations 2002 (Cth) Sch 1 cl 13A'
from usage u join cases c on c.id = u.case_id join products p on p.id = u.product_id join hospitals h on h.id = c.hospital_id
where h.country = 'AU' and p.card_required and not u.implant_card_given
union all
-- R05: an open market action has affected units still in stock or in a loan set, not quarantined.
select 'R05', t.action, t.sku || coalesce(' lot ' || t.lot_no, '') || ': ' || sum(t.qty) || ' unit(s) still in ' || string_agg(distinct t.place, ', '), null, null,
       'TGA Procedure for Recalls, Product Alerts and Product Corrections (2025); NZ Medicines and Medical Devices Recall Code (2015)'
from recall_trace t
where t.held_in in ('stock', 'set')
group by t.action, t.sku, t.lot_no
union all
-- R06: an implant used in an Australian private hospital has a Prescribed List billing code.
select 'R06', c.code, p.sku || ' used at ' || h.code || ' (private) with no Prescribed List billing code', c.surgery_on, null,
       'Private Health Insurance (Medical Devices and Human Tissue Products) Rules, Sch 1 (Prescribed List)'
from usage u join cases c on c.id = u.case_id join products p on p.id = u.product_id join hospitals h on h.id = c.hospital_id
where h.country = 'AU' and h.sector = 'private' and p.kind = 'implant' and p.billing_code = ''
union all
-- H01: the hospital's loan set lead time (house rule from each hospital's loan policy).
select 'H01', c.case_code, c.set_code || ' for ' || c.hospital || case when localtimestamp > c.deliver_by then ' not delivered, was due ' else ' due at the hospital by ' end || to_char(c.deliver_by, 'YYYY-MM-DD HH24:MI'),
       c.deliver_by::date, c.deliver_by::date - current_date, 'Hospital loan set policy: lead hours on the hospital record'
from case_set_checks c
where c.delivered_at is null and localtimestamp > c.deliver_by - interval '24 hours'
union all
-- H02: nothing sterile goes out past its expiry or expiring before the surgery.
select 'H02', c.case_code, c.set_code || ': ' || c.items_expiring || ' item(s) expire on or before surgery ' || c.surgery_on, c.surgery_on, c.surgery_on - current_date,
       'House rule: no item leaves the warehouse expiring before the surgery'
from case_set_checks c
where c.items_expiring > 0;
