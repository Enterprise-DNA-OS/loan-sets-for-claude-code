-- Demo data for Loan Sets for Claude Code. Every hospital, surgeon, product and record is fictional.
-- An orthopaedic distributor in New Zealand and Australia: knee and hip loan sets, consignment at two hospitals.
-- Dates are relative to today so the demo always has something due, late, short or stuck.
-- Idempotent: a second run does nothing. Never run this against a working database.
do $$
begin
  if exists (select 1 from hospitals where code = 'NHP') then
    return;
  end if;

  insert into hospitals (code, name, country, sector, loan_lead_hours, return_days, theatre_contact, theatre_email, accounts_email) values
    ('NHP', 'North Harbour Private Hospital', 'NZ', 'private', 48, 3, 'Leanne Ford', 'theatre@northharbour.example', 'accounts@northharbour.example'),
    ('WGH', 'Waitaha General Hospital', 'NZ', 'public', 48, 3, 'Sam Herewini', 'cssd@waitaha.example', 'payables@waitaha.example'),
    ('BRP', 'Bayside Private Hospital Brisbane', 'AU', 'private', 48, 3, 'Kylie Brennan', 'theatres@baysidebne.example', 'accounts@baysidebne.example'),
    ('NPH', 'Northside Public Hospital Sydney', 'AU', 'public', 24, 4, 'Tom Nguyen', 'loansets@northside.example', 'ap@northside.example');

  insert into reps (code, name, region, email) values
    ('MT', 'Mia Tane', 'Auckland and Canterbury', 'mia@distributor.example'),
    ('JR', 'Josh Reilly', 'Queensland', 'josh@distributor.example'),
    ('PS', 'Priya Shah', 'New South Wales', 'priya@distributor.example');

  insert into surgeons (code, name, specialty, hospital_id)
  select v.code, v.name, 'Orthopaedics', h.id
  from (values
    ('DRW', 'Dr Hamish Walker', 'NHP'),
    ('DRK', 'Dr Anahera Kingi', 'WGH'),
    ('DRB', 'Dr Fiona Bell', 'BRP'),
    ('DRL', 'Dr Michael Lau', 'NPH')
  ) as v(code, name, hosp) join hospitals h on h.code = v.hosp;

  insert into products (sku, description, kind, track, card_required, price_cents, artg_no, billing_code, first_supplied_nz_on, wand_notified_on) values
    ('KN-FEM-3',  'Knee femoral component, size 3',      'implant',    'serial', true,  320000, 'ARTG 400101', 'KD001', current_date - 900, current_date - 880),
    ('KN-TIB-3',  'Knee tibial tray, size 3',            'implant',    'serial', true,  210000, 'ARTG 400102', 'KD002', current_date - 900, current_date - 880),
    ('KN-INS-10', 'Knee tibial insert, 10 mm',           'implant',    'lot',    true,   95000, 'ARTG 400103', 'KD003', current_date - 900, current_date - 880),
    ('BC-40',     'Bone cement, 40 g',                   'implant',    'lot',    false,  18000, 'ARTG 400104', 'KD004', current_date - 900, current_date - 880),
    ('SCR-6545',  'Cancellous screw, 6.5 x 45 mm',       'implant',    'lot',    false,  12000, 'ARTG 400105', 'KD005', current_date - 900, current_date - 880),
    ('HIP-STM-12','Hip femoral stem, size 12',           'implant',    'serial', true,  280000, '',            '',      current_date - 300, current_date - 290),
    ('HIP-HD-32', 'Hip femoral head, 32 mm',             'implant',    'lot',    true,   90000, 'ARTG 400107', 'KD007', current_date - 900, current_date - 880),
    ('HIP-CUP-52','Acetabular cup, 52 mm',               'implant',    'serial', true,  240000, 'ARTG 400108', 'KD008', current_date - 900, current_date - 880),
    ('WDG-AUG-5', 'Tibial augment wedge, 5 mm',          'implant',    'lot',    true,   65000, 'ARTG 400109', 'KD009', current_date - 40,  null),
    ('INS-KN-GD', 'Knee cutting guide instrument tray',  'instrument', 'none',   false,      0, '',            '',      null, null),
    ('INS-HP-RM', 'Hip reamer instrument tray',          'instrument', 'none',   false,      0, '',            '',      null, null);

  insert into lots (product_id, lot_no, expires_on)
  select p.id, v.lot, current_date + v.days
  from (values
    ('KN-INS-10', 'L2401', 400), ('KN-INS-10', 'L2398', 5),
    ('BC-40', 'C881', 60), ('BC-40', 'C902', 500),
    ('SCR-6545', 'S7710', 700), ('SCR-6545', 'S7702', 650),
    ('HIP-HD-32', 'H5521', 380),
    ('WDG-AUG-5', 'W0103', 720)
  ) as v(sku, lot, days) join products p on p.sku = v.sku;

  insert into locations (code, name, kind, country, hospital_id, rep_id)
  select v.code, v.name, v.kind, v.country, h.id, r.id
  from (values
    ('WH-AKL', 'Auckland warehouse', 'warehouse', 'NZ', null, null),
    ('WH-BNE', 'Brisbane warehouse', 'warehouse', 'AU', null, null),
    ('NHP-CON', 'North Harbour consignment cupboard', 'consignment', 'NZ', 'NHP', null),
    ('BRP-CON', 'Bayside consignment room', 'consignment', 'AU', 'BRP', null),
    ('TRK-JR', 'Josh Reilly trunk stock', 'trunk', 'AU', null, 'JR'),
    ('QUAR-AKL', 'Auckland quarantine shelf', 'quarantine', 'NZ', null, null)
  ) as v(code, name, kind, country, hosp, rep)
  left join hospitals h on h.code = v.hosp
  left join reps r on r.code = v.rep;

  insert into stock (location_id, product_id, lot_id, qty, last_moved_on)
  select l.id, p.id, lo.id, v.qty, current_date - v.still
  from (values
    ('WH-AKL', 'KN-INS-10', 'L2401', 12, 5),
    ('WH-AKL', 'BC-40', 'C902', 30, 5),
    ('WH-AKL', 'WDG-AUG-5', 'W0103', 6, 20),
    ('WH-BNE', 'HIP-HD-32', 'H5521', 10, 8),
    ('WH-BNE', 'SCR-6545', 'S7710', 40, 8),
    ('NHP-CON', 'KN-INS-10', 'L2401', 1, 12),
    ('NHP-CON', 'BC-40', 'C881', 6, 220),
    ('NHP-CON', 'SCR-6545', 'S7702', 3, 40),
    ('BRP-CON', 'HIP-HD-32', 'H5521', 4, 15),
    ('BRP-CON', 'SCR-6545', 'S7710', 10, 15),
    ('TRK-JR', 'BC-40', 'C902', 4, 200),
    ('WH-AKL', 'KN-INS-10', 'L2398', 2, 60)
  ) as v(loc, sku, lot, qty, still)
  join locations l on l.code = v.loc
  join products p on p.sku = v.sku
  left join lots lo on lo.product_id = p.id and lo.lot_no = v.lot;

  insert into stock (location_id, product_id, qty, last_moved_on)
  select l.id, p.id, 1, current_date - 30
  from locations l, products p where l.code = 'WH-BNE' and p.sku = 'HIP-STM-12';

  insert into pars (location_id, product_id, par)
  select l.id, p.id, v.par
  from (values ('NHP-CON', 'KN-INS-10', 4), ('NHP-CON', 'BC-40', 4), ('NHP-CON', 'SCR-6545', 3),
               ('BRP-CON', 'HIP-HD-32', 6), ('BRP-CON', 'SCR-6545', 8)) as v(loc, sku, par)
  join locations l on l.code = v.loc join products p on p.sku = v.sku;

  insert into kits (code, name, specialty) values
    ('KNEE-PRI', 'Primary knee set', 'Knee'),
    ('HIP-PRI', 'Primary hip set', 'Hip');

  insert into kit_lines (kit_id, product_id, qty)
  select k.id, p.id, v.qty
  from (values
    ('KNEE-PRI', 'INS-KN-GD', 1), ('KNEE-PRI', 'KN-FEM-3', 1), ('KNEE-PRI', 'KN-TIB-3', 1), ('KNEE-PRI', 'KN-INS-10', 2), ('KNEE-PRI', 'BC-40', 2),
    ('HIP-PRI', 'INS-HP-RM', 1), ('HIP-PRI', 'HIP-STM-12', 1), ('HIP-PRI', 'HIP-HD-32', 1), ('HIP-PRI', 'HIP-CUP-52', 1), ('HIP-PRI', 'SCR-6545', 3)
  ) as v(kit, sku, qty) join kits k on k.code = v.kit join products p on p.sku = v.sku;

  insert into sets (code, kit_id, home_location_id, status, hospital_id, last_checked_on)
  select v.code, k.id, l.id, v.status, h.id, current_date - v.checked
  from (values
    ('KN-01', 'KNEE-PRI', 'WH-AKL', 'available', null, 10),
    ('KN-02', 'KNEE-PRI', 'WH-AKL', 'at_hospital', 'WGH', 9),
    ('KN-03', 'KNEE-PRI', 'WH-AKL', 'available', null, 4),
    ('HP-01', 'HIP-PRI', 'WH-BNE', 'at_hospital', 'BRP', 3),
    ('HP-02', 'HIP-PRI', 'WH-BNE', 'available', null, 6),
    ('HP-03', 'HIP-PRI', 'WH-BNE', 'available', null, 70)
  ) as v(code, kit, home, status, hosp, checked)
  join kits k on k.code = v.kit join locations l on l.code = v.home left join hospitals h on h.code = v.hosp;

  -- Set contents. KN-01 is one insert short. KN-03 holds an insert lot that expires in 5 days.
  -- HP-02 holds three screws from lot S7702, which is under recall.
  insert into set_items (set_id, product_id, lot_id, qty)
  select s.id, p.id, lo.id, v.qty
  from (values
    ('KN-01', 'INS-KN-GD', null, 1), ('KN-01', 'KN-FEM-3', null, 1), ('KN-01', 'KN-TIB-3', null, 1), ('KN-01', 'KN-INS-10', 'L2401', 1), ('KN-01', 'BC-40', 'C902', 2),
    ('KN-02', 'INS-KN-GD', null, 1), ('KN-02', 'KN-FEM-3', null, 1), ('KN-02', 'KN-TIB-3', null, 1), ('KN-02', 'KN-INS-10', 'L2401', 2), ('KN-02', 'BC-40', 'C902', 2),
    ('KN-03', 'INS-KN-GD', null, 1), ('KN-03', 'KN-FEM-3', null, 1), ('KN-03', 'KN-TIB-3', null, 1), ('KN-03', 'KN-INS-10', 'L2398', 2), ('KN-03', 'BC-40', 'C902', 2),
    ('HP-01', 'INS-HP-RM', null, 1), ('HP-01', 'HIP-STM-12', null, 1), ('HP-01', 'HIP-HD-32', 'H5521', 1), ('HP-01', 'HIP-CUP-52', null, 1), ('HP-01', 'SCR-6545', 'S7710', 3),
    ('HP-02', 'INS-HP-RM', null, 1), ('HP-02', 'HIP-STM-12', null, 1), ('HP-02', 'HIP-HD-32', 'H5521', 1), ('HP-02', 'HIP-CUP-52', null, 1), ('HP-02', 'SCR-6545', 'S7702', 3),
    ('HP-03', 'INS-HP-RM', null, 1), ('HP-03', 'HIP-STM-12', null, 1), ('HP-03', 'HIP-HD-32', 'H5521', 1), ('HP-03', 'HIP-CUP-52', null, 1), ('HP-03', 'SCR-6545', 'S7710', 3)
  ) as v(set_code, sku, lot, qty)
  join sets s on s.code = v.set_code join products p on p.sku = v.sku
  left join lots lo on lo.product_id = p.id and lo.lot_no = v.lot;

  insert into cases (code, hospital_id, surgeon_id, rep_id, procedure, surgery_on, status, patient_ref, po_number, charge_sheet_on, billed_on, invoice_no)
  select v.code, h.id, sg.id, r.id, v.proc, current_date + v.day, v.status, v.patient, v.po,
         case when v.sheet is null then null else current_date + v.sheet end,
         case when v.billed is null then null else current_date + v.billed end, v.inv
  from (values
    ('C-1101', 'NHP', 'DRW', 'MT', 'Total knee replacement, right', 1, 'confirmed', 'MRN 448120', '', null, null, ''),
    ('C-1102', 'BRP', 'DRB', 'JR', 'Total hip replacement, left', 3, 'confirmed', 'MRN B-77231', 'PO-55120', null, null, ''),
    ('C-1103', 'NPH', 'DRL', 'PS', 'Total hip replacement, right', 4, 'booked', 'MRN N-90114', '', null, null, ''),
    ('C-1104', 'BRP', 'DRB', 'JR', 'Total hip replacement, right', 5, 'booked', 'MRN B-77302', '', null, null, ''),
    ('C-1105', 'WGH', 'DRK', 'MT', 'Total knee replacement, left', 8, 'booked', 'NHI ZZB1234', '', null, null, ''),
    ('C-1106', 'NHP', 'DRW', 'MT', 'Total knee replacement, left', 2, 'booked', 'MRN 448377', '', null, null, ''),
    ('C-1090', 'WGH', 'DRK', 'MT', 'Total knee replacement, right', -6, 'done', 'NHI ZZC5678', 'WGH-4471', -5, null, ''),
    ('C-1091', 'BRP', 'DRB', 'JR', 'Total hip replacement, left', -4, 'done', 'MRN B-76990', '', -3, null, ''),
    ('C-1092', 'NHP', 'DRW', 'MT', 'Total knee replacement, right', -3, 'done', 'MRN 447901', '', null, null, ''),
    ('C-1080', 'NHP', 'DRW', 'MT', 'Total knee replacement, left', -20, 'done', 'MRN 446310', 'NHP-9902', -19, -15, 'INV-30411'),
    ('C-1081', 'BRP', 'DRB', 'JR', 'Total hip replacement, right', -30, 'done', 'MRN B-75510', 'PO-54007', -29, -25, 'INV-30388'),
    ('C-1070', 'NPH', 'DRL', 'PS', 'Total hip replacement, left', -2, 'cancelled', '', '', null, null, '')
  ) as v(code, hosp, surgeon, rep, proc, day, status, patient, po, sheet, billed, inv)
  join hospitals h on h.code = v.hosp
  left join surgeons sg on sg.code = v.surgeon
  left join reps r on r.code = v.rep;

  -- Sets booked to cases. KN-01 for tomorrow is not shipped. HP-02 is booked on two hip cases a day apart.
  -- KN-02 went to Waitaha six days ago and has not come back. C-1106 has no set.
  insert into case_sets (case_id, set_id, shipped_on, delivered_at, returned_on)
  select c.id, s.id,
         case when v.shipped is null then null else current_date + v.shipped end,
         case when v.delivered is null then null else (current_date + v.delivered)::timestamp + interval '14 hours' end,
         case when v.returned is null then null else current_date + v.returned end
  from (values
    ('C-1101', 'KN-01', null, null, null),
    ('C-1102', 'HP-01', -2, -1, null),
    ('C-1103', 'HP-02', null, null, null),
    ('C-1104', 'HP-02', null, null, null),
    ('C-1105', 'KN-03', null, null, null),
    ('C-1090', 'KN-02', -8, -7, null),
    ('C-1091', 'HP-03', -6, -5, -1),
    ('C-1092', 'KN-01', -5, -4, -1),
    ('C-1080', 'KN-01', -22, -21, -17),
    ('C-1081', 'HP-01', -32, -31, -27)
  ) as v(case_code, set_code, shipped, delivered, returned)
  join cases c on c.code = v.case_code join sets s on s.code = v.set_code;

  -- Usage from charge sheets. C-1091 at Bayside: the stem has no ARTG or billing code on record,
  -- the head has no implant card recorded, and the screws were written up with no lot.
  -- C-1080 used three screws from lot S7702, now under recall. C-1092 has no charge sheet yet.
  insert into usage (case_id, product_id, lot_id, serial_no, qty, source, set_id, location_id, implant_card_given, price_cents)
  select c.id, p.id, lo.id, v.serial, v.qty, v.source, s.id, l.id, v.card, p.price_cents
  from (values
    ('C-1090', 'KN-FEM-3', null, 'SN-F3-22018', 1, 'set', 'KN-02', null, true),
    ('C-1090', 'KN-TIB-3', null, 'SN-T3-11873', 1, 'set', 'KN-02', null, true),
    ('C-1090', 'KN-INS-10', 'L2401', '', 1, 'set', 'KN-02', null, true),
    ('C-1090', 'BC-40', 'C902', '', 2, 'set', 'KN-02', null, false),
    ('C-1091', 'HIP-STM-12', null, 'SN-S12-0451', 1, 'set', 'HP-03', null, true),
    ('C-1091', 'HIP-HD-32', 'H5521', '', 1, 'set', 'HP-03', null, false),
    ('C-1091', 'HIP-CUP-52', null, 'SN-C52-3310', 1, 'set', 'HP-03', null, true),
    ('C-1091', 'SCR-6545', null, '', 2, 'consignment', null, 'BRP-CON', false),
    ('C-1080', 'KN-FEM-3', null, 'SN-F3-21950', 1, 'set', 'KN-01', null, true),
    ('C-1080', 'KN-TIB-3', null, 'SN-T3-11790', 1, 'set', 'KN-01', null, true),
    ('C-1080', 'KN-INS-10', 'L2401', '', 1, 'set', 'KN-01', null, true),
    ('C-1080', 'SCR-6545', 'S7702', '', 3, 'consignment', null, 'NHP-CON', false),
    ('C-1081', 'HIP-STM-12', null, 'SN-S12-0388', 1, 'set', 'HP-01', null, true),
    ('C-1081', 'HIP-HD-32', 'H5521', '', 1, 'set', 'HP-01', null, true),
    ('C-1081', 'HIP-CUP-52', null, 'SN-C52-3255', 1, 'set', 'HP-01', null, true)
  ) as v(case_code, sku, lot, serial, qty, source, set_code, loc, card)
  join cases c on c.code = v.case_code join products p on p.sku = v.sku
  left join lots lo on lo.product_id = p.id and lo.lot_no = v.lot
  left join sets s on s.code = v.set_code
  left join locations l on l.code = v.loc;

  insert into market_actions (code, product_id, lot_id, kind, country, notified_on, reason, status)
  select 'MA-2026-07', p.id, lo.id, 'recall', 'both', current_date - 2, 'Thread finish out of specification on lot S7702', 'open'
  from products p join lots lo on lo.product_id = p.id and lo.lot_no = 'S7702' where p.sku = 'SCR-6545';

  insert into notes (case_id, hospital_id, kind, body, actor, noted_on)
  select c.id, c.hospital_id, 'call', 'Theatre confirmed Dr Walker list, starts 07:30.', 'Mia Tane', current_date - 1
  from cases c where c.code = 'C-1101';
end
$$;
