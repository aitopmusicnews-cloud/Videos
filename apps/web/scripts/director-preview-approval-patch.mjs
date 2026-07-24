function replaceRange(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Could not apply ${label}; start marker was not found.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Could not apply ${label}; end marker was not found.`);
  return source.slice(0, start) + replacement + source.slice(end);
}

export function patchDirectorPreviewApprovals(source, replaceRequired) {
  let patched = source;

  patched = replaceRequired(
    patched,
    `import { toast } from "../lib/toast.js";`,
    `import { pollTask, startImageToVideo, startTextToVideo } from "../lib/api.js";\nimport { toast } from "../lib/toast.js";`,
    "Director preview API imports",
  );

  patched = replaceRequired(
    patched,
    `  activeSectionIndex: number;\n  planAccepted: boolean;`,
    `  activeSectionIndex: number;\n  stylePreviewUrl: string | null;\n  sectionPreviewUrls: Record<string, string>;\n  planAccepted: boolean;`,
    "Director preview session fields",
  );

  patched = replaceRequired(
    patched,
    `    activeSectionIndex: 0,\n    planAccepted: false,`,
    `    activeSectionIndex: 0,\n    stylePreviewUrl: null,\n    sectionPreviewUrls: {},\n    planAccepted: false,`,
    "Director preview session defaults",
  );

  patched = replaceRequired(
    patched,
    `function formatTime(seconds: number): string {\n  const safe = Math.max(0, seconds);\n  const minutes = Math.floor(safe / 60);\n  const remainder = safe - minutes * 60;\n  return \`\${minutes}:\${remainder.toFixed(1).padStart(4, "0")}\`;\n}\n\nexport function LtxDirectorAgent() {`,
    `function formatTime(seconds: number): string {\n  const safe = Math.max(0, seconds);\n  const minutes = Math.floor(safe / 60);\n  const remainder = safe - minutes * 60;\n  return \`\${minutes}:\${remainder.toFixed(1).padStart(4, "0")}\`;\n}\n\nfunction directorPreviewOutputUrl(task: any): string | undefined {\n  if (typeof task?.outputUrl === "string") return task.outputUrl;\n  if (Array.isArray(task?.output)) return task.output.find((value: unknown) => typeof value === "string");\n  return task?.output?.videoUrl ?? task?.output?.imageUrl ?? task?.output?.url;\n}\n\nexport function LtxDirectorAgent() {`,
    "Director preview task output helper",
  );

  patched = replaceRange(
    patched,
    `  const updateTreatment = (key: keyof Treatment, value: string) => {`,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>`,
    `  const updateTreatment = (key: keyof Treatment, value: string) => {\n    setSession((current) => current.plan ? {\n      ...current,\n      treatmentApproved: false,\n      approvedSectionKeys: [],\n      activeSectionIndex: 0,\n      stylePreviewUrl: null,\n      sectionPreviewUrls: {},\n      planAccepted: false,\n      plan: { ...current.plan, treatment: { ...current.plan.treatment, [key]: value } },\n    } : current);\n  };\n\n  const updateCharacterBible = <K extends keyof CharacterBible,>`,
    "clear style and section previews after treatment edits",
  );

  patched = replaceRange(
    patched,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => {`,
    `  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {`,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => {\n    setSession((current) => current.plan ? {\n      ...current,\n      characterBibleApproved: false,\n      treatmentApproved: false,\n      approvedSectionKeys: [],\n      activeSectionIndex: 0,\n      stylePreviewUrl: null,\n      sectionPreviewUrls: {},\n      planAccepted: false,\n      plan: { ...current.plan, characterBible: { ...current.plan.characterBible, [key]: value } },\n    } : current);\n  };\n\n  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {`,
    "clear previews after character edits",
  );

  patched = replaceRange(
    patched,
    `  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {`,
    `  const resolveReferenceUrl = (referenceId: string | null): string => {`,
    `  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {\n    const editedSectionIndex = approvalSections.findIndex((section) => section.shots.some((shot) => shot.clipId === shotId));\n    const retainedKeys = new Set(approvalSections.slice(0, Math.max(0, editedSectionIndex)).map((section) => section.key));\n    setSession((current) => current.plan ? {\n      ...current,\n      approvedSectionKeys: current.approvedSectionKeys.filter((key) => retainedKeys.has(key)),\n      activeSectionIndex: editedSectionIndex >= 0 ? editedSectionIndex : current.activeSectionIndex,\n      sectionPreviewUrls: Object.fromEntries(Object.entries(current.sectionPreviewUrls).filter(([key]) => retainedKeys.has(key))),\n      planAccepted: false,\n      plan: {\n        ...current.plan,\n        shots: current.plan.shots.map((shot) => shot.clipId === shotId ? { ...shot, ...patch } : shot),\n      },\n    } : current);\n  };\n\n  const resolveReferenceUrl = (referenceId: string | null): string => {`,
    "clear current and later previews after shot edits",
  );

  patched = replaceRequired(
    patched,
    `        approvedSectionKeys: [],\n        activeSectionIndex: 0,\n        planAccepted: false,\n        productionStarted: false,`,
    `        approvedSectionKeys: [],\n        activeSectionIndex: 0,\n        stylePreviewUrl: null,\n        sectionPreviewUrls: {},\n        planAccepted: false,\n        productionStarted: false,`,
    "reset previews after Gemini planning",
  );

  patched = replaceRange(
    patched,
    `  const approveTreatment = () => {`,
    `  const approveActiveSongSection = () => {`,
    `  const approveCharacterBible = () => {\n    const bible = session.plan?.characterBible;\n    if (!bible) return;\n    const characterUrl = resolveReferenceUrl(bible.referenceId);\n    if (session.characterRequired && !characterUrl) {\n      setError("Select a valid character image. The locked character preview must be visible before approval.");\n      return;\n    }\n    if (session.characterRequired && (!bible.referenceSummary.trim() || !bible.wardrobe.trim() || bible.immutableTraits.length === 0)) {\n      setError("Complete the character summary, immutable traits, and wardrobe lock before approval.");\n      return;\n    }\n    setError(null);\n    updateSession({\n      characterBibleApproved: true,\n      treatmentApproved: false,\n      approvedSectionKeys: [],\n      activeSectionIndex: 0,\n      stylePreviewUrl: null,\n      sectionPreviewUrls: {},\n      planAccepted: false,\n    });\n    toast.success("Character locked. Generate and approve the LTX style preview next.");\n  };\n\n  const generateStylePreview = async () => {\n    const plan = session.plan;\n    if (!plan || !session.characterBibleApproved) return;\n    const characterUrl = resolveReferenceUrl(plan.characterBible.referenceId);\n    if (session.characterRequired && !characterUrl) {\n      setError("The locked character image is missing. Re-select and approve the character before generating a style preview.");\n      return;\n    }\n    const prompt = [\n      "Create a short LTX-2.3 visual style proof for a music video.",\n      characterUrl ? "Use the exact person from the supplied character frame without changing identity, facial geometry, hair, skin tone, body proportions, wardrobe, or accessories." : "No principal character appears in this style proof.",\n      \`Visual style: \${plan.treatment.visualStyle}\`,\n      \`Color palette and lighting: \${plan.treatment.colorPalette}\`,\n      \`Camera language: \${plan.treatment.cameraLanguage}\`,\n      \`Continuity rules: \${plan.treatment.continuityStrategy}\`,\n      \`Character lock: \${plan.characterBible.referenceSummary}. Wardrobe: \${plan.characterBible.wardrobe}.\`,\n      "Use restrained movement and a clear face so identity and styling can be judged before production.",\n    ].filter(Boolean).join(" ");\n\n    setError(null);\n    setBusy("Generating the LTX character-and-style proof");\n    try {\n      const task = characterUrl\n        ? await startImageToVideo({ promptText: prompt, promptImage: characterUrl, imageUrl: characterUrl, characterRequired: session.characterRequired, duration: 2, model: "ltx-video" })\n        : await startTextToVideo({ promptText: prompt, duration: 2, model: "ltx-video" });\n      const final = await pollTask(task.id, 2500, 900_000);\n      const outputUrl = directorPreviewOutputUrl(final);\n      if ((final.status || "").toUpperCase() !== "SUCCEEDED" || !outputUrl) {\n        throw new Error(final.error ?? \`Style preview ended in \${final.status}\`);\n      }\n      updateSession({ stylePreviewUrl: outputUrl, treatmentApproved: false, approvedSectionKeys: [], activeSectionIndex: 0, sectionPreviewUrls: {}, planAccepted: false });\n      toast.success("Style preview ready. Review the character and visual language before approval.");\n    } catch (failure) {\n      const message = failure instanceof Error ? failure.message : String(failure);\n      setError(message);\n      toast.error(\`Style preview failed: \${message.slice(0, 160)}\`);\n    } finally {\n      setBusy(null);\n    }\n  };\n\n  const approveTreatment = () => {\n    const treatment = session.plan?.treatment;\n    if (!treatment) return;\n    const missing = Object.entries(treatment).filter(([, value]) => typeof value !== "string" || !value.trim()).map(([key]) => key);\n    if (missing.length > 0) {\n      setError(\`Complete the visual style before approval: \${missing.join(", ")}\`);\n      return;\n    }\n    if (!session.stylePreviewUrl) {\n      setError("Generate and watch the LTX style preview before approving the style.");\n      return;\n    }\n    setError(null);\n    updateSession({ treatmentApproved: true, approvedSectionKeys: [], activeSectionIndex: 0, sectionPreviewUrls: {}, planAccepted: false });\n    toast.success("Visual style approved. The first analyzed song section is unlocked.");\n  };\n\n  const generateActiveSectionPreview = async () => {\n    const section = activeApprovalSection;\n    const plan = session.plan;\n    if (!section || !plan || !session.treatmentApproved) return;\n    const shot = section.shots.find((item) => item.requiresCharacter) ?? section.shots[0];\n    if (!shot) return;\n    const conditioningUrl = resolveReferenceUrl(shot.conditioningReferenceId ?? plan.characterBible.referenceId);\n    if (shot.requiresCharacter && !conditioningUrl) {\n      setError(\`\${section.label} cannot preview because its character conditioning image is missing.\`);\n      return;\n    }\n    const prompt = [\n      shot.prompt,\n      \`Approved style: \${plan.treatment.visualStyle}.\`,\n      \`Approved palette: \${plan.treatment.colorPalette}.\`,\n      \`Approved camera language: \${plan.treatment.cameraLanguage}.\`,\n      shot.requiresCharacter ? \`Keep the exact approved character unchanged. \${plan.characterBible.referenceSummary}. \${plan.characterBible.wardrobe}.\` : "",\n      \`Continuity: \${shot.continuityNotes}.\`,\n    ].filter(Boolean).join(" ");\n    const duration = Math.min(5, Math.max(1, shot.end - shot.start));\n\n    setError(null);\n    setBusy(\`Generating representative LTX preview for \${section.label}\`);\n    try {\n      const task = conditioningUrl\n        ? await startImageToVideo({ promptText: prompt, promptImage: conditioningUrl, imageUrl: conditioningUrl, characterRequired: shot.requiresCharacter, duration, model: "ltx-video" })\n        : await startTextToVideo({ promptText: prompt, duration, model: "ltx-video" });\n      const final = await pollTask(task.id, 2500, 900_000);\n      const outputUrl = directorPreviewOutputUrl(final);\n      if ((final.status || "").toUpperCase() !== "SUCCEEDED" || !outputUrl) {\n        throw new Error(final.error ?? \`Section preview ended in \${final.status}\`);\n      }\n      setSession((current) => ({\n        ...current,\n        sectionPreviewUrls: { ...current.sectionPreviewUrls, [section.key]: outputUrl },\n        approvedSectionKeys: current.approvedSectionKeys.filter((key) => key !== section.key),\n        planAccepted: false,\n      }));\n      toast.success(\`\${section.label} preview ready. Watch it before approval.\`);\n    } catch (failure) {\n      const message = failure instanceof Error ? failure.message : String(failure);\n      setError(message);\n      toast.error(\`Section preview failed: \${message.slice(0, 160)}\`);\n    } finally {\n      setBusy(null);\n    }\n  };\n\n  const approveActiveSongSection = () => {`,
    "preview-first character and style approval actions",
  );

  patched = replaceRange(
    patched,
    `  const approveActiveSongSection = () => {`,
    `  const validateAndApplyPlan = (): boolean => {`,
    `  const approveActiveSongSection = () => {\n    const section = activeApprovalSection;\n    if (!section) return;\n    const problems: string[] = [];\n    if (!session.sectionPreviewUrls[section.key]) {\n      problems.push(\`Generate and watch the \${section.label} LTX preview before approval\`);\n    }\n    for (const shot of section.shots) {\n      const promptWords = words(shot.prompt);\n      if (shot.prompt.trim().length < 20) problems.push(\`\${shot.sectionLabel} needs a complete LTX prompt\`);\n      if (promptWords > 200) problems.push(\`\${shot.sectionLabel} prompt has \${promptWords} words; maximum is 200\`);\n      if (shot.requiresCharacter && !resolveReferenceUrl(shot.conditioningReferenceId)) {\n        problems.push(\`\${shot.sectionLabel} needs a valid character conditioning image\`);\n      }\n    }\n    if (problems.length > 0) {\n      setError(problems.join("; "));\n      return;\n    }\n    const nextKeys = Array.from(new Set([...session.approvedSectionKeys, section.key]));\n    const nextIndex = Math.min(visibleSectionIndex + 1, Math.max(0, approvalSections.length - 1));\n    setError(null);\n    updateSession({ approvedSectionKeys: nextKeys, activeSectionIndex: nextIndex, planAccepted: false });\n    if (nextKeys.length === approvalSections.length) {\n      toast.success("Every analyzed song section and preview is approved. The timeline can now be built.");\n    } else {\n      toast.success(\`\${section.label} approved. Next song section unlocked.\`);\n    }\n  };\n\n  const validateAndApplyPlan = (): boolean => {`,
    "require preview before song section approval",
  );

  patched = replaceRequired(
    patched,
    `      setError("Approve the treatment, character bible, and every analyzed song section before building the timeline.");`,
    `      setError("Approve the locked character, visual style preview, and every analyzed song-section preview before building the timeline.");`,
    "preview-first final approval error",
  );

  patched = patched
    .replaceAll(`activeSectionIndex: 0, planAccepted: false`, `activeSectionIndex: 0, stylePreviewUrl: null, sectionPreviewUrls: {}, planAccepted: false`)
    .replaceAll(`activeSectionIndex: 0,\n      planAccepted: false`, `activeSectionIndex: 0,\n      stylePreviewUrl: null,\n      sectionPreviewUrls: {},\n      planAccepted: false`);

  const treatmentStart = `              <section style={sectionStyle}>\n                <h3 style={sectionTitleStyle}>2. Editable treatment`;
  const songGateStart = `              {session.characterBibleApproved ? (\n                <section style={sectionStyle}>\n                  <h3 style={sectionTitleStyle}>4. Approve analyzed song sections in order`;
  patched = replaceRange(
    patched,
    treatmentStart,
    songGateStart,
    `              <section style={sectionStyle}>\n                <h3 style={sectionTitleStyle}>2. Lock the character {session.characterBibleApproved ? "✓" : ""}</h3>\n                <p style={helpStyle}>This is the actual image used to condition character shots. Approve only after the face, hair, skin tone, body proportions, wardrobe, and accessories are correct.</p>\n                <label style={fieldStyle}>\n                  <span>Primary conditioning asset</span>\n                  <select value={session.plan.characterBible.referenceId ?? ""} onChange={(event) => updateCharacterBible("referenceId", event.target.value || null)} style={inputStyle}>\n                    <option value="">No asset selected</option>\n                    {referenceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}\n                  </select>\n                </label>\n                {resolveReferenceUrl(session.plan.characterBible.referenceId) ? (\n                  <div style={previewFrameStyle}><img src={resolveReferenceUrl(session.plan.characterBible.referenceId)} alt="Locked character preview" style={previewImageStyle} /></div>\n                ) : (\n                  <div style={blockingStyle}>No character preview is visible. Add or select a character image before approval.</div>\n                )}\n                <Field label="Reference summary" value={session.plan.characterBible.referenceSummary} onChange={(value) => updateCharacterBible("referenceSummary", value)} />\n                <Field label="Immutable traits" value={session.plan.characterBible.immutableTraits.join("\\n")} onChange={(value) => updateCharacterBible("immutableTraits", value.split("\\n").filter(Boolean))} />\n                <Field label="Wardrobe lock" value={session.plan.characterBible.wardrobe} onChange={(value) => updateCharacterBible("wardrobe", value)} />\n                <Field label="Prohibited changes" value={session.plan.characterBible.prohibitedChanges.join("\\n")} onChange={(value) => updateCharacterBible("prohibitedChanges", value.split("\\n").filter(Boolean))} />\n                <div style={actionRowStyle}>\n                  <button type="button" className="btn primary" disabled={!!busy || session.characterBibleApproved || (session.characterRequired && !resolveReferenceUrl(session.plan.characterBible.referenceId))} onClick={approveCharacterBible}>\n                    {session.characterBibleApproved ? "Character locked ✓" : "Approve and lock character"}\n                  </button>\n                  <button type="button" className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-reference-chat"))}>Change character reference</button>\n                </div>\n              </section>\n\n              {session.characterBibleApproved ? (\n                <section style={sectionStyle}>\n                  <h3 style={sectionTitleStyle}>3. Approve the visual style {session.treatmentApproved ? "✓" : ""}</h3>\n                  <div style={modelBadgeStyle}>Planned by {session.plan.agentModel}</div>\n                  <Field label="Title" value={session.plan.treatment.title} onChange={(value) => updateTreatment("title", value)} singleLine />\n                  <Field label="Logline" value={session.plan.treatment.logline} onChange={(value) => updateTreatment("logline", value)} />\n                  <Field label="Visual style" value={session.plan.treatment.visualStyle} onChange={(value) => updateTreatment("visualStyle", value)} />\n                  <Field label="Color palette" value={session.plan.treatment.colorPalette} onChange={(value) => updateTreatment("colorPalette", value)} />\n                  <Field label="Camera language" value={session.plan.treatment.cameraLanguage} onChange={(value) => updateTreatment("cameraLanguage", value)} />\n                  <Field label="Continuity strategy" value={session.plan.treatment.continuityStrategy} onChange={(value) => updateTreatment("continuityStrategy", value)} />\n                  <div style={actionRowStyle}>\n                    <button type="button" className="btn" disabled={!!busy} onClick={() => void generateStylePreview()}>\n                      {session.stylePreviewUrl ? "Regenerate LTX style preview" : "Generate LTX style preview"}\n                    </button>\n                  </div>\n                  {session.stylePreviewUrl ? (\n                    <div style={previewFrameStyle}><video src={session.stylePreviewUrl} controls playsInline style={previewVideoStyle} /></div>\n                  ) : (\n                    <div style={blockingStyle}>A visual style preview is required before style approval.</div>\n                  )}\n                  <div style={actionRowStyle}>\n                    <button type="button" className="btn primary" disabled={!!busy || session.treatmentApproved || !session.stylePreviewUrl} onClick={approveTreatment}>\n                      {session.treatmentApproved ? "Visual style approved ✓" : "Approve visual style and continue"}\n                    </button>\n                  </div>\n                </section>\n              ) : (\n                <section style={{ ...sectionStyle, opacity: .5 }}>\n                  <h3 style={sectionTitleStyle}>3. Visual style · Locked</h3>\n                  <div style={blockingStyle}>Approve the visible character reference before generating the style proof.</div>\n                </section>\n              )}\n\n`,
    "character-first visual preview gates",
  );

  patched = replaceRequired(
    patched,
    `{session.characterBibleApproved ? (\n                <section style={sectionStyle}>\n                  <h3 style={sectionTitleStyle}>4. Approve analyzed song sections in order</h3>`,
    `{session.treatmentApproved ? (\n                <section style={sectionStyle}>\n                  <h3 style={sectionTitleStyle}>4. Preview and approve analyzed song sections</h3>`,
    "unlock song sections after style approval",
  );

  patched = replaceRequired(
    patched,
    `<p style={helpStyle}>Only the current song section is unlocked. Editing an approved section revokes its approval and every later section approval.</p>`,
    `<p style={helpStyle}>Each musical section requires a representative LTX preview using the approved character and style. Editing a section removes its preview and every later approval.</p>`,
    "song section preview instructions",
  );

  patched = replaceRequired(
    patched,
    `                      <div style={modelBadgeStyle}>\n                        Section {visibleSectionIndex + 1} of {approvalSections.length} · {activeApprovalSection.label} · {formatTime(activeApprovalSection.start)}–{formatTime(activeApprovalSection.end)}\n                      </div>\n                      <div style={shotGridStyle}>`,
    `                      <div style={modelBadgeStyle}>\n                        Section {visibleSectionIndex + 1} of {approvalSections.length} · {activeApprovalSection.label} · {formatTime(activeApprovalSection.start)}–{formatTime(activeApprovalSection.end)}\n                      </div>\n                      <div style={actionRowStyle}>\n                        <button type="button" className="btn" disabled={!!busy} onClick={() => void generateActiveSectionPreview()}>\n                          {session.sectionPreviewUrls[activeApprovalSection.key] ? "Regenerate section preview" : "Generate section preview"}\n                        </button>\n                      </div>\n                      {session.sectionPreviewUrls[activeApprovalSection.key] ? (\n                        <div style={previewFrameStyle}><video src={session.sectionPreviewUrls[activeApprovalSection.key]} controls playsInline style={previewVideoStyle} /></div>\n                      ) : (\n                        <div style={blockingStyle}>This section cannot be approved until its LTX preview is generated and visible.</div>\n                      )}\n                      <div style={shotGridStyle}>`,
    "active song section LTX preview",
  );

  patched = replaceRequired(
    patched,
    `                           disabled={!!busy || approvedSectionKeySet.has(activeApprovalSection.key)}`,
    `                           disabled={!!busy || approvedSectionKeySet.has(activeApprovalSection.key) || !session.sectionPreviewUrls[activeApprovalSection.key]}`,
    "disable section approval until preview exists",
  );

  patched = replaceRequired(
    patched,
    `<h3 style={sectionTitleStyle}>4. Song section approvals · Locked</h3>\n                   <div style={blockingStyle}>Approve the character bible before reviewing the first analyzed song section.</div>`,
    `<h3 style={sectionTitleStyle}>4. Song-section previews · Locked</h3>\n                   <div style={blockingStyle}>Approve the LTX visual-style preview before reviewing song sections.</div>`,
    "song preview locked message",
  );

  patched = replaceRequired(
    patched,
    `const countStyle: CSSProperties = { marginTop: 6, textAlign: "right", fontSize: 10 };`,
    `const countStyle: CSSProperties = { marginTop: 6, textAlign: "right", fontSize: 10 };\nconst previewFrameStyle: CSSProperties = { marginTop: 14, padding: 10, borderRadius: 12, border: "1px solid rgba(134,239,172,.3)", background: "#050505" };\nconst previewImageStyle: CSSProperties = { display: "block", width: "100%", maxHeight: 520, objectFit: "contain", borderRadius: 8, background: "#000" };\nconst previewVideoStyle: CSSProperties = { display: "block", width: "100%", maxHeight: 520, borderRadius: 8, background: "#000" };`,
    "Director preview media styles",
  );

  return patched;
}
