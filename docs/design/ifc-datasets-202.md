# Public IFC admission sidecar — #202 / #192

Checked 2026-10-27. Research only; #197 owns the native prototype. Recommend these two licensed authored exports for later read-only qualification. **Neither fits the spike**: IFC4 only, <=2,097,152 source bytes, <=2,000 entities, <=64 products. No representative building meeting all four limits was established here. Preserve the gates; converted/truncated copies are separate datasets. No 200,000 m² or performance qualification is implied.

## 1. Small residential: Duplex Apartment architecture

Publisher: buildingSMART community; copyright belongs to unnamed original authors. The README describes a two-storey duplex with simulated consultant models and traces publication through Germany, US CERL and NIBS. As-built provenance is unverified. File-specific **CC BY 4.0** permits redistribution/modification. Required credit: `BSI (2020) "Duplex Apartment Test Files," buildingSMART International`, plus repository URL; link the license and identify modifications. [Provenance/rights][duplex-readme]; [terms][cc].

- File: `IFC 2.3.0.1 (IFC 2x3)/Duplex Apartment/Duplex_A_20110907.ifc`.
- Git commit: `7ddf57a201f88a0c213d5322b02ed15e94a60a40` (GitHub ref verified).
- [Direct IFC][duplex-download]: HTTP 200; **2,380,763 bytes**; SHA-256 `b347a2c8aa8fff6db896a4417a9c50c22ac0ccd7c5cfc22b99b8d29336c606ed`, hashed in memory and matching the [LFS pointer][duplex-pointer]. The media URL avoids downloading a 132-byte pointer.
- Header: `IFC2X3`, CoordinationView, Revit Architecture 2011, export `2011-09-07T12:28:29`. Text inventory: 38,898 entities, 1 building, 4 storeys, 21 spaces, 56 `IfcWallStandardCase`, 14 doors, 24 windows, 1,459 property sets. [Source][duplex-download].
- Unit assignment #23: metres, square/cubic metres, degrees, seconds. WCS #26/#3=(0,0,0); TrueNorth unset. Site #38274 latitude=(41,52,27,840000), longitude=(-87,-38,-21,-839999), elevation=-0. Storeys approximately -1.25, 0, 3.1, 6 m. Survey alignment/placement chains unverified. [Source][duplex-download].

**Requires separate qualification:** IFC2X3 and all capacity bounds fail; walls plus doors prove >64 products. Useful for rooms, openings, furnishings, types and storey navigation.

## 2. More complex building: DigitalHub architecture V2

Publisher/licensor: **RWTH Aachen University, E3D Institute of Energy Efficiency and Sustainable Building**, copyright 2020. Its model repository grants **MIT** redistribution/modification rights; include the complete copyright/permission notice. No per-file exception was found in the inspected tree. [License][hub-license]; [tree][hub-tree]. V2 is the October 2023 IFC4 Reference View export; architecture, ventilation, heating and sanitation models are listed. Architecture alone is selected; federation completeness/built-site extent is unverified. [Author README][hub-readme].

- File: `Version_2/DigitalHub_FM-ARC_v2.ifc`.
- Git commit: `36565d529b4dadeca625de2b793d7e16700171e9` (GitHub ref verified).
- [Direct IFC download][hub-download]: HTTP 200; **9,022,255 bytes**; independently computed SHA-256 `19d7d02d53c2b88e86890ee236297b12bbb0f7748030cd32ff6a22762e9966bb`.
- Header: `IFC4`, ReferenceView_V1.2, Architecture exchange, Revit 2019, export `2023-10-27T09:19:25`. Text inventory: 91,602 entities, 1 building, 3 storeys, 64 spaces, 178 walls, 64 doors, 47 windows, 150 proxies, 8,037 property sets, 722 quantity sets. [Source][hub-download].
- Assignment #109 includes metre/square-metre/cubic-metre and degree units; a decimetre unit also occurs: resolve property-specific units. WCS #111/#6=(0,0,0); TrueNorth #112=(~6.123e-17,1). #123 declares `EPSG:3857`; map conversion #125 E/N/H=(0,0,0), X-axis=(1,~6.123e-17), scale=`$`. Site #175 separately declares latitude=(48,8,15,359802), longitude=(11,34,47,783432), elevation=519; storeys -3.37, -0.15, 3.75 m. Consistency/placement chains need verification before trusting survey alignment. [Source][hub-download].

**Requires separate qualification:** byte/entity bounds fail; walls exceed 64 products. Useful for geometry, proxies, quantities and CRS records.

## Proposed download/admission manifest and UI handoff

Manifest v1 proposal: entries `duplex-architecture` and `digitalhub-architecture-v2` use the records above for `publisher`, `author`, `commit`, `sourcePath`, `sourceUrl`, `expectedBytes`, `sha256`, `schema`, `license`, `rightsEvidenceUrl`, `attribution`, `retrievedUtc`, `unitAssignment`, `coordinates`, `observedEntityDeclarations`. Initially `status=requires-separate-qualification`, `productCount=null`, `qualificationReceipt=null`. Add license-notice hash/content, representation/loss inventory, validator version, rejection reasons and receipt URL/hash. Digests identify original IFC bytes.

1. Offer direct links without Git LFS/authoring-tool setup. Sample-loading UI must show failed bounds and qualification status. Admission/testing belongs in a separately reviewed server-container task.
2. Fetch pinned individual URLs into quarantine: HEAD/API first, hard cap at declared bytes; reject unexpected redirect hosts, length/hash mismatch, pointer/HTML or schema mismatch. No archives, bulk clone or external conversion. >20 MiB needs prior admission; neither selected file crosses it.
3. Later container validation must count schema-derived `IfcProduct` instances (including spatial/opening products), entities and representations. Reject bound failures before geometry work. Record unsupported geometry/proxies/openings/spaces/metadata and all losses; never silently discard them. Qualify originals and derivatives separately.
4. Preserve units, nested/mapped placements, axes/handedness, WCS precision, TrueNorth, CRS and map conversion. Record an invertible display-recentering transform. Compare door/wall/space placements, storey heights and bounds before/after; investigate DigitalHub georeferencing consistency.
5. Preserve GlobalIds, source references, containment, types, void/fill relations, classifications, materials, property/quantity names, typed values and units. Check missing/duplicate IDs. Assert readback by source digest + GlobalId, stable selection after reload, and zero model delta from read-only loading; retain a before/after inventory. Renderer IDs cannot replace BIM identity.

Method: capped in-memory HTTP downloads, SHA-256 and lexical STEP scans; no IFC files saved, conversions, installs, npm, tests, benchmarks or container/image jobs. Counts/coordinate records await schema-aware confirmation. The community publisher warns these are not official buildingSMART examples and many fail validation. [Warning][community-readme].

[duplex-readme]: https://github.com/buildingsmart-community/Community-Sample-Test-Files/blob/7ddf57a201f88a0c213d5322b02ed15e94a60a40/IFC%202.3.0.1%20%28IFC%202x3%29/Duplex%20Apartment/README.md
[duplex-pointer]: https://raw.githubusercontent.com/buildingsmart-community/Community-Sample-Test-Files/7ddf57a201f88a0c213d5322b02ed15e94a60a40/IFC%202.3.0.1%20%28IFC%202x3%29/Duplex%20Apartment/Duplex_A_20110907.ifc
[duplex-download]: https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/7ddf57a201f88a0c213d5322b02ed15e94a60a40/IFC%202.3.0.1%20%28IFC%202x3%29/Duplex%20Apartment/Duplex_A_20110907.ifc
[community-readme]: https://github.com/buildingsmart-community/Community-Sample-Test-Files/blob/7ddf57a201f88a0c213d5322b02ed15e94a60a40/README.md
[cc]: https://creativecommons.org/licenses/by/4.0/
[hub-tree]: https://api.github.com/repos/RWTH-E3D/DigitalHub/git/trees/36565d529b4dadeca625de2b793d7e16700171e9?recursive=1
[hub-license]: https://github.com/RWTH-E3D/DigitalHub/blob/36565d529b4dadeca625de2b793d7e16700171e9/LICENSE
[hub-readme]: https://github.com/RWTH-E3D/DigitalHub/blob/36565d529b4dadeca625de2b793d7e16700171e9/README.md
[hub-download]: https://raw.githubusercontent.com/RWTH-E3D/DigitalHub/36565d529b4dadeca625de2b793d7e16700171e9/Version_2/DigitalHub_FM-ARC_v2.ifc
