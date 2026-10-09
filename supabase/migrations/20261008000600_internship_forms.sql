-- Internship-level forms: 5.8 End of dental internship training evaluation and
-- 5.9 Verification of completion. They belong to the internship, not to a
-- rotation, so rotation_id becomes optional for these two kinds only.

alter table public.assessment alter column rotation_id drop not null;

alter table public.assessment drop constraint if exists assessment_kind_check;
alter table public.assessment add constraint assessment_kind_check
  check (kind in ('monthly', 'mid_rotation', 'end_of_rotation', 'overall_rotation', 'end_of_internship', 'completion_verification'));

alter table public.assessment add constraint assessment_rotation_scope check (
  (kind in ('end_of_internship', 'completion_verification')) = (rotation_id is null)
);

create unique index assessment_one_per_internship_form on public.assessment (internship_id, kind)
  where rotation_id is null and deleted_at is null;
