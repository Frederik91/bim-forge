# Actual manifest preflight review

QVM-01, issues #142 and #148, 25 October 2026. This concerns the downstream qualification reader. The executing full import remains pinned to `c0ad967`.

A file-only preflight compared the real reduced manifest with its already verified source/load artifacts. It exposed a false rejection in the reader: the manifest declares `correspondsTo: 0`, while the observed count map omits categories with no rows. All positive counts matched. No database operation was part of this check.

The [focused regression](round2-20261025/catalog-counts-red.txt) failed at extracted original behavior `3da3f2c` for zero-frequency categories in entity, relationship and parameter catalogs. The correction `49f363e` derives expected positive frequencies for all catalogs. It does not special-case a kind name, modify source documents, or remove a nonzero count. The [passing tests](round2-20261025/catalog-counts-green.txt) retain rejection of a missing nonempty category.

The corrected reader supports the existing reduced scale, allowing the [actual 270,205-record admission](round2-20261025/actual-admission-preflight.json) to be checked at its original scale. Exact admission/table/body/property bindings and the pinned revision remain required. The pure preflight also parsed all three real full selection templates and their expected bounds. Those are expected manifest counts, not executed database selection results.

The reader and bounded inspector are combined at `962d602`. Root validation, focused strict checking and [four pure tests](round2-20261025/qualification-final-pure-tests.txt) pass. Storage TypeScript is unchanged from `c0ad967`; the reader is unchanged from `49f363e`. The original 42 storage and 13 PostgreSQL runner tests remain bound to `c0ad967`; no database suite ran during the full hold. The later real-data stage must retain its actual runner and original admission source as separate bindings.

The inspector reads exact known revision/receipt/change/body keys in a read-only repeatable-read transaction. Missing receipts and mismatched metadata remain facts, not a pass. It avoids whole-table counts, ancestry reconstruction and branch copies. Its source-only tests do not establish database execution; actual stage inspection remains pending at this review.

Source fixes remain draft [#149](https://github.com/Frederik91/bim-forge/pull/149) and [#150](https://github.com/Frederik91/bim-forge/pull/150). Raw roots are `artifacts/issue148-red`, `artifacts/issue148-green` and `artifacts/qualification-final-962d602` beneath `/ssd1/bim-forge-qualification/qvm-20261025`. No full-capacity, engineering or adoption verdict follows from this metadata fix. Original full-trial and reduced-comparison records remain unchanged.
