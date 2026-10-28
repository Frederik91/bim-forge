# Geometry access for LLM BIM authoring: literature map

Research date: 2026-10-28. Issue: [#225](https://github.com/Frederik91/bim-forge/issues/225).

These are primary-source findings, not reproduced benchmark results. Full text was inspected for BIM-Edit, ToolCAD, QueryCAD, the Cambridge CAD framework, VSI-Bench, and SpatialLM. Release availability was checked separately. No external datasets, weights, or code were imported into the pilot.

## Decision suggested by the literature

Use semantic identities and relations to retrieve relevant objects, then compute dimensions, distances, and intersections with bounded host tools. Add images when needed to resolve visual references and detect gross mistakes. Keep visual identification, geometric measurement, and model acceptance separate.

This is an inference across different task domains. None of the papers establishes that a particular BIM Forge API is reliable. The pilot must test that inference using identical tasks, independent grading, and explicit missing/stale states.

## Evidence map

### BIM-Edit: existing IFC edits require several kinds of correctness

The [full paper, v3](https://arxiv.org/html/2606.20146v3) evaluates 324 tasks across 11 realistic models and 36 synthetic scenes. Its agent executes IfcOpenShell Python in a subprocess, with 20 tool calls per task. Evaluation distinguishes geometry, semantics, and topology and scores the changed edit set rather than letting unchanged building content dominate.

The reported best average is approximately 49.5%; at most 3.4% of tasks are fully solved. Runtime completion therefore does not establish correct BIM editing. Spatial/topological references and create operations are relevant stressors for this pilot. The benchmark does not compare our proposed summary, spatial-tool, and image contracts under matched information budgets.

[Public model data](https://huggingface.co/datasets/BIM-Edit/BIM-Edit), [tasks](https://huggingface.co/datasets/BIM-Edit/BIM-Edit-Tasks), and [cached runs](https://huggingface.co/datasets/BIM-Edit/BIM-Edit-runs) exist. The data cards declare CC BY 4.0; Appendix J says the harness/evaluator is MIT and author-created assets CC BY 4.0. A separately accessible harness repository and its license file were not verified. The runs viewer reports a schema-cast error; that is a viewer limitation, not proof that raw files are unavailable.

### BIBIMBAP: relevant lead, unresolved primary-source access

The nominated [conference publication page](https://ec-3.org/publication/ec32026_271/) repeatedly timed out; the [DOI route](https://doi.org/10.35490/EC3.2026.271) was also inaccessible through the research tool.

Consequently, this note makes no quantitative claims about BIBIMBAP's task count, results, methods, or release license. Secondary bibliographic listings are insufficient evidence for architecture decisions. Full text, author-owned code/data, and exact reuse terms remain follow-up work.

### ToolCAD: executable tools and feedback, with training confounds

[ToolCAD, v2](https://arxiv.org/html/2604.07960v2) studies text-to-CAD agents interacting with FreeCAD through tools, hybrid rule/outcome feedback, and post-training. Table 1 reports higher modeling success for ReAct than zero-shot prompting on the listed backbones, followed by further gains from its trained system. Its case analysis includes near-miss unit and Boolean errors that a visual judge can miss.

The transferable idea is executable engine feedback. The reported gains combine interaction policy, training, and environment design; they do not prove that tools alone outperform summaries for editing linked BIM geometry. Manufacturing-part generation also does not establish room, host, or IFC relationship correctness.

The author's [project site](https://gongyifeiisme.github.io/toolcad-project/) presents a Code link, but it resolves to the same coming-soon page. Released training code, weights, dataset package, and their licenses were not verified. The paper's arXiv publication license is not a software/data reuse grant.

### Visual-feedback CAD agents: useful checks, limited exactness evidence

The [Cambridge full paper](https://www.cambridge.org/core/journals/proceedings-of-the-design-society/article/from-text-to-design-a-framework-to-leverage-llm-agents-for-automated-cad-generation/5BD8D63CFCED28BDD7A01313162FFBE7) compares five LLMs and four workflows using Rhino/Grasshopper primitives and generated Python. Visual inspection extends clarification and planning by returning rendered output for correction.

Reported success depends on shape complexity: visual inspection with GPT-4 Turbo succeeds 11/15 times on a corner plate but 5/15 on the more complex FCRC bracket. This supports testing visual repair, while giving no guarantee of millimetre clearance or preserved BIM relationships. The visual arm also receives additional feedback and calls, so its benefit cannot be attributed to image representation alone.

Appendix A links [R-SMP/text-to-design](https://github.com/R-SMP/text-to-design); retrieval timed out during this investigation, so repository contents and software/data license were not verified. The article itself declares CC BY-NC-ND 4.0. No code or figures were copied.

### QueryCAD: the closest precedent for grounded retrieval plus computation

[QueryCAD full text](https://arxiv.org/html/2409.08704) combines rendered-view segmentation, ray casting back to CAD faces, and generated Python over geometric properties. It explicitly moves unit conversion and measurement reasoning into code.

Its 111 manually checked questions cover 18 CAD models. Results are 44 correct, 15 partial, and 52 incorrect. Among 67 noncorrect outcomes, the authors classify 52 as mask/raycast problems, 14 as CAD-interface limitations, and 1 as reasoning; none are syntax failures. Thus successful execution and arithmetic access can coexist with poor answers when identification or API coverage is wrong.

This directly motivates stable object/face identities, explicit unresolved selections, and independent clearance checks. It also warns against treating segmentation as exact authority. These are mechanical CAD questions, not accepted BIM edits.

The [author repository](https://github.com/claudius-kienle/querycad) is public. A reuse license was not visible in the inspected repository view; exact code and benchmark asset terms remain unverified. Its industrial/ABC-derived model provenance must be checked before importing assets.

### VSI-Bench: visual spatial scores do not establish engineering tolerance

[Thinking in Space](https://arxiv.org/html/2412.14171) evaluates video spatial understanding using more than 5,000 questions from 288 indoor scenes. Numerical answers use mean relative accuracy over several relative-error thresholds; categorical questions use accuracy. Its error analysis identifies spatial reasoning failures despite coherent scene descriptions.

The transferable tests are viewpoint/frame conversion, relative direction, occlusion, counting, and room-scale reasoning. Its numerical scoring tolerances differ from an absolute engineering clearance requirement, and the benchmark does not create or validate BIM objects. Its leaderboard cannot establish that images provide exact geometry access.

The [official evaluation repository](https://github.com/vision-x-nyu/thinking-in-space) is public with an [Apache 2.0 license](https://raw.githubusercontent.com/vision-x-nyu/thinking-in-space/main/LICENSE). The [dataset card](https://huggingface.co/datasets/nyu-visionx/VSI-Bench) also declares Apache 2.0. Underlying ScanNet/ScanNet++/ARKitScenes asset terms were not independently audited; no scene media were imported.

### SpatialLM: structured scene output is a representation precedent

[SpatialLM full text](https://arxiv.org/html/2506.07491) maps point clouds to structured indoor layouts and object boxes. Its [official implementation](https://github.com/manycore-research/SpatialLM) exposes walls, doors, windows, and semantic oriented boxes; the README requires axis-aligned inputs with Z up and links inference/evaluation scripts, datasets, and checkpoints.

This supports investigating a compact scene representation and making coordinate conventions explicit. It does not establish exact reconstruction of arbitrary IFC solids, valid openings, support relationships, or source freshness. Reconstructing geometry already available from an authoritative BIM source would add estimation error unless it solves a specific missing-data problem.

The repository's [LICENSE.txt](https://raw.githubusercontent.com/manycore-research/SpatialLM/main/LICENSE.txt) contains the Llama 3.2 Community License. Do not label the whole release MIT/Apache or infer uniform rights for every backbone, checkpoint, and dataset. Those artifact-specific terms were not fully audited, and nothing was downloaded for the pilot.

## Competing hypotheses and discriminating tests

| Hypothesis | Why plausible | What would falsify it |
| --- | --- | --- |
| Compact summaries suffice for simple authoring | Dimensions and frames can fit in little context. | Identical summaries support incompatible answers for openings, concavities, or occupied sides. |
| Semantic relations plus exact queries are the smallest useful core | BIM references require identity/containment; kernels handle metric work. | Queries omit decisive geometry, or query/API failures dominate matched trials. |
| Progressive retrieval saves context without reducing correctness | Most requests concern a small neighborhood. | Required drill-down is missed or extra calls erase observed savings. |
| Sandboxed computation improves numeric reliability | QueryCAD delegates units and measurements to code. | Correct scripts repeatedly reason over wrong selections or stale/incomplete data. |
| Images improve grounding and repair | Visual CAD work demonstrates useful feedback. | Occlusion/view ambiguity causes mistaken identity; exact tools add no benefit under matched inputs. |
| A hybrid gives the best practical tradeoff | Visual references and exact geometry solve different problems. | Added views/calls fail to improve correctness at a disclosed resource budget. |

Keep task sets, source facts, prompts, and budgets comparable. Distinguish retrieval-information gains from representation or reasoning gains. Report unsupported/abstained cases and independently measured violations beside success counts. Runtime success, visually plausible output, and fluent explanations are insufficient acceptance evidence.
