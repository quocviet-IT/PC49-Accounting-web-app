# PC49 UI/UX upgrade

User authorizes UI implementation, superseding the previous read-only audit. Preserve accounting, settlement formulas, permissions and production data.

## Implementation
1. Shared foundation: persistent viewport sidebar, bounded page/table overflow, consistent spacing, accessible search and filter toolbar, pagination defaults, reusable tabs and form sections, unified icons.
2. Gold transactions: searchable multidimensional filters, pagination, readable aligned columns and responsive structured entry form.
3. Cash and inventory: task-oriented tabs, reusable tables and filters; retain reconciliation and imports.
4. Dashboard: meaningful charts from real source data with clearly stated scope, loading failures and empty states.
5. Refining and remaining lists: tabs for long detail screens, searchable paginated lists, consistent forms and actions.
6. Verify: meaningful filter/aggregation tests, existing library tests, TypeScript, ESLint, production build and browser desktop/mobile inspection.

## Coordination
Root owns common components, global styles, shell, dictionary integration and final verification. Domain implementers own separate source files and domain translation modules. No production mutations or deployment.

## Progress
- Plan created. Baseline working tree clean.
