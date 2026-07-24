export function patchDirectorSectionApprovals(source, replaceRequired) {
  let patched = source;

  patched = replaceRequired(
    patched,
    `  planAccepted: boolean;
  productionStarted: boolean;`,
    `  treatmentApproved: boolean;
  characterBibleApproved: boolean;
  approvedSectionKeys: string[];
  activeSectionIndex: number;
  planAccepted: boolean;
  productionStarted: boolean;`,
    "Director staged approval session fields",
  );

  patched = replaceRequired(
    patched,
    `    planAccepted: false,
    productionStarted: false,`,
    `    treatmentApproved: false,
    characterBibleApproved: false,
    approvedSectionKeys: [],
    activeSectionIndex: 0,
    planAccepted: false,
    productionStarted: false,`,
    "Director staged approval defaults",
  );

  patched = replaceRequired(
    patched,
    `  const clipProgress = useMemo(() => ({`,
    `  const approvalSections = useMemo(() => {
    const plan = session.plan;
    if (!plan) return [];

    const analyzedSections = analysis.sections ?? [];
    if (analyzedSections.length === 0) {
      return plan.shots.map((shot, index) => ({
        key: \`shot-section-\${index}-\${shot.clipId}\`,
        label: shot.sectionLabel || \`Section \${index + 1}\`,
        start: shot.start,
        end: shot.end,
        shots: [shot],
      }));
    }

    const groups = analyzedSections.map((section, index) => ({
      key: \`analysis-section-\${index}-\${Number(section.start ?? 0).toFixed(3)}\`,
      label: String(section.label || \`Section \${index + 1}\`),
      start: Number(section.start ?? 0),
      end: Number(section.end ?? analysis.duration),
      shots: [] as LtxShotPlan[],
    }));

    for (const shot of plan.shots) {
      const midpoint = (shot.start + shot.end) / 2;
      let groupIndex = groups.findIndex((group, index) =>
        midpoint >= group.start && (midpoint < group.end || (index === groups.length - 1 && midpoint <= group.end))
      );
      if (groupIndex < 0) {
        let bestDistance = Number.POSITIVE_INFINITY;
        groups.forEach((group, index) => {
          const distance = Math.min(Math.abs(midpoint - group.start), Math.abs(midpoint - group.end));
          if (distance < bestDistance) {
            bestDistance = distance;
            groupIndex = index;
          }
        });
      }
      if (groupIndex >= 0) groups[groupIndex]!.shots.push(shot);
    }

    return groups.filter((group) => group.shots.length > 0);
  }, [session.plan, analysis.sections, analysis.duration]);

  const approvedSectionKeySet = new Set(session.approvedSectionKeys);
  const allSectionsApproved = approvalSections.length > 0 && approvalSections.every((section) => approvedSectionKeySet.has(section.key));
  const firstUnapprovedSectionIndex = approvalSections.findIndex((section) => !approvedSectionKeySet.has(section.key));
  const maxUnlockedSectionIndex = firstUnapprovedSectionIndex < 0
    ? Math.max(0, approvalSections.length - 1)
    : firstUnapprovedSectionIndex;
  const visibleSectionIndex = Math.min(
    Math.max(0, session.activeSectionIndex),
    Math.max(0, maxUnlockedSectionIndex),
  );
  const activeApprovalSection = approvalSections[visibleSectionIndex];

  const clipProgress = useMemo(() => ({`,
    "derive analyzed song approval sections",
  );

  patched = replaceRequired(
    patched,
    `  const updateTreatment = (key: keyof Treatment, value: string) => {
    setSession((current) => current.plan ? {
      ...current,
      planAccepted: false,
      plan: { ...current.plan, treatment: { ...current.plan.treatment, [key]: value } },
    } : current);
  };`,
    `  const updateTreatment = (key: keyof Treatment, value: string) => {
    setSession((current) => current.plan ? {
      ...current,
      treatmentApproved: false,
      characterBibleApproved: false,
      approvedSectionKeys: [],
      activeSectionIndex: 0,
      planAccepted: false,
      plan: { ...current.plan, treatment: { ...current.plan.treatment, [key]: value } },
    } : current);
  };`,
    "revoke downstream approvals after treatment edits",
  );

  patched = replaceRequired(
    patched,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => {
    setSession((current) => current.plan ? {
      ...current,
      planAccepted: false,
      plan: { ...current.plan, characterBible: { ...current.plan.characterBible, [key]: value } },
    } : current);
  };`,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => {
    setSession((current) => current.plan ? {
      ...current,
      characterBibleApproved: false,
      approvedSectionKeys: [],
      activeSectionIndex: 0,
      planAccepted: false,
      plan: { ...current.plan, characterBible: { ...current.plan.characterBible, [key]: value } },
    } : current);
  };`,
    "revoke song section approvals after character edits",
  );

  patched = replaceRequired(
    patched,
    `  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {
    setSession((current) => current.plan ? {
      ...current,
      planAccepted: false,
      plan: {
        ...current.plan,
        shots: current.plan.shots.map((shot) => shot.clipId === shotId ? { ...shot, ...patch } : shot),
      },
    } : current);
  };`,
    `  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {
    const editedSectionIndex = approvalSections.findIndex((section) => section.shots.some((shot) => shot.clipId === shotId));
    const retainedKeys = new Set(
      approvalSections
        .slice(0, Math.max(0, editedSectionIndex))
        .map((section) => section.key),
    );
    setSession((current) => current.plan ? {
      ...current,
      approvedSectionKeys: current.approvedSectionKeys.filter((key) => retainedKeys.has(key)),
      activeSectionIndex: editedSectionIndex >= 0 ? editedSectionIndex : current.activeSectionIndex,
      planAccepted: false,
      plan: {
        ...current.plan,
        shots: current.plan.shots.map((shot) => shot.clipId === shotId ? { ...shot, ...patch } : shot),
      },
    } : current);
  };`,
    "revoke current and later section approvals after shot edits",
  );

  patched = replaceRequired(
    patched,
    `      updateSession({ plan, planAccepted: false, productionStarted: false });`,
    `      updateSession({
        plan,
        treatmentApproved: false,
        characterBibleApproved: false,
        approvedSectionKeys: [],
        activeSectionIndex: 0,
        planAccepted: false,
        productionStarted: false,
      });`,
    "reset staged approvals after Gemini planning",
  );

  patched = replaceRequired(
    patched,
    `  const validateAndApplyPlan = (): boolean => {`,
    `  const approveTreatment = () => {
    const treatment = session.plan?.treatment;
    if (!treatment) return;
    const missing = Object.entries(treatment)
      .filter(([, value]) => typeof value !== "string" || !value.trim())
      .map(([key]) => key);
    if (missing.length > 0) {
      setError(\`Complete the treatment before approval: \${missing.join(", ")}\`);
      return;
    }
    setError(null);
    updateSession({
      treatmentApproved: true,
      characterBibleApproved: false,
      approvedSectionKeys: [],
      activeSectionIndex: 0,
      planAccepted: false,
    });
    toast.success("Treatment approved. Character bible unlocked.");
  };

  const approveCharacterBible = () => {
    const bible = session.plan?.characterBible;
    if (!bible) return;
    if (session.characterRequired && !resolveReferenceUrl(bible.referenceId)) {
      setError("Approve a valid character conditioning image before continuing to song sections.");
      return;
    }
    if (session.characterRequired && (!bible.referenceSummary.trim() || !bible.wardrobe.trim() || bible.immutableTraits.length === 0)) {
      setError("Complete the character summary, immutable traits, and wardrobe lock before approval.");
      return;
    }
    setError(null);
    updateSession({
      characterBibleApproved: true,
      approvedSectionKeys: [],
      activeSectionIndex: 0,
      planAccepted: false,
    });
    toast.success("Character bible approved. First song section unlocked.");
  };

  const approveActiveSongSection = () => {
    const section = activeApprovalSection;
    if (!section) return;
    const problems: string[] = [];
    for (const shot of section.shots) {
      const promptWords = words(shot.prompt);
      if (shot.prompt.trim().length < 20) problems.push(\`\${shot.sectionLabel} needs a complete LTX prompt\`);
      if (promptWords > 200) problems.push(\`\${shot.sectionLabel} prompt has \${promptWords} words; maximum is 200\`);
      if (shot.requiresCharacter && !resolveReferenceUrl(shot.conditioningReferenceId)) {
        problems.push(\`\${shot.sectionLabel} needs a valid character conditioning image\`);
      }
    }
    if (problems.length > 0) {
      setError(problems.join("; "));
      return;
    }

    const nextKeys = Array.from(new Set([...session.approvedSectionKeys, section.key]));
    const nextIndex = Math.min(visibleSectionIndex + 1, Math.max(0, approvalSections.length - 1));
    setError(null);
    updateSession({
      approvedSectionKeys: nextKeys,
      activeSectionIndex: nextIndex,
      planAccepted: false,
    });
    if (nextKeys.length === approvalSections.length) {
      toast.success("Every analyzed song section is approved. The timeline can now be built.");
    } else {
      toast.success(\`\${section.label} approved. Next song section unlocked.\`);
    }
  };

  const validateAndApplyPlan = (): boolean => {`,
    "staged Director approval actions",
  );

  patched = replaceRequired(
    patched,
    `    const plan = session.plan;
    if (!plan) return false;
    const clipIds = new Set(clips.map((clip) => clip.id));`,
    `    const plan = session.plan;
    if (!plan) return false;
    if (!session.treatmentApproved || !session.characterBibleApproved || !allSectionsApproved) {
      setError("Approve the treatment, character bible, and every analyzed song section before building the timeline.");
      return false;
    }
    const clipIds = new Set(clips.map((clip) => clip.id));`,
    "require all staged approvals before timeline build",
  );

  patched = replaceRequired(
    patched,
    `<Field label="Vision" value={session.vision} onChange={(vision) => updateSession({ vision, planAccepted: false })} placeholder="Describe the story, performance, world, emotion, locations, wardrobe, and camera behavior." />
            <Field label="Must include" value={session.mustInclude} onChange={(mustInclude) => updateSession({ mustInclude, planAccepted: false })} placeholder="Required actions, locations, props, symbols, wardrobe, or visual moments." />
            <Field label="Avoid" value={session.avoid} onChange={(avoid) => updateSession({ avoid, planAccepted: false })} placeholder="Anything the agent and LTX must not show." />`,
    `<Field label="Vision" value={session.vision} onChange={(vision) => updateSession({ vision, treatmentApproved: false, characterBibleApproved: false, approvedSectionKeys: [], activeSectionIndex: 0, planAccepted: false })} placeholder="Describe the story, performance, world, emotion, locations, wardrobe, and camera behavior." />
            <Field label="Must include" value={session.mustInclude} onChange={(mustInclude) => updateSession({ mustInclude, treatmentApproved: false, characterBibleApproved: false, approvedSectionKeys: [], activeSectionIndex: 0, planAccepted: false })} placeholder="Required actions, locations, props, symbols, wardrobe, or visual moments." />
            <Field label="Avoid" value={session.avoid} onChange={(avoid) => updateSession({ avoid, treatmentApproved: false, characterBibleApproved: false, approvedSectionKeys: [], activeSectionIndex: 0, planAccepted: false })} placeholder="Anything the agent and LTX must not show." />`,
    "revoke approvals after creative direction edits",
  );

  patched = replaceRequired(
    patched,
    `<input type="checkbox" checked={session.characterRequired} onChange={(event) => updateSession({ characterRequired: event.target.checked, planAccepted: false })} />`,
    `<input type="checkbox" checked={session.characterRequired} onChange={(event) => updateSession({ characterRequired: event.target.checked, treatmentApproved: false, characterBibleApproved: false, approvedSectionKeys: [], activeSectionIndex: 0, planAccepted: false })} />`,
    "revoke approvals after conditioning mode changes",
  );

  patched = replaceRequired(
    patched,
    `              <section style={sectionStyle}>
                <h3 style={sectionTitleStyle}>2. Editable treatment</h3>
                <div style={modelBadgeStyle}>Planned by {session.plan.agentModel}</div>
                <Field label="Title" value={session.plan.treatment.title} onChange={(value) => updateTreatment("title", value)} singleLine />
                <Field label="Logline" value={session.plan.treatment.logline} onChange={(value) => updateTreatment("logline", value)} />
                <Field label="Visual style" value={session.plan.treatment.visualStyle} onChange={(value) => updateTreatment("visualStyle", value)} />
                <Field label="Color palette" value={session.plan.treatment.colorPalette} onChange={(value) => updateTreatment("colorPalette", value)} />
                <Field label="Camera language" value={session.plan.treatment.cameraLanguage} onChange={(value) => updateTreatment("cameraLanguage", value)} />
                <Field label="Continuity strategy" value={session.plan.treatment.continuityStrategy} onChange={(value) => updateTreatment("continuityStrategy", value)} />
              </section>`,
    `              <section style={sectionStyle}>
                <h3 style={sectionTitleStyle}>2. Editable treatment {session.treatmentApproved ? "✓" : ""}</h3>
                <div style={modelBadgeStyle}>Planned by {session.plan.agentModel}</div>
                <Field label="Title" value={session.plan.treatment.title} onChange={(value) => updateTreatment("title", value)} singleLine />
                <Field label="Logline" value={session.plan.treatment.logline} onChange={(value) => updateTreatment("logline", value)} />
                <Field label="Visual style" value={session.plan.treatment.visualStyle} onChange={(value) => updateTreatment("visualStyle", value)} />
                <Field label="Color palette" value={session.plan.treatment.colorPalette} onChange={(value) => updateTreatment("colorPalette", value)} />
                <Field label="Camera language" value={session.plan.treatment.cameraLanguage} onChange={(value) => updateTreatment("cameraLanguage", value)} />
                <Field label="Continuity strategy" value={session.plan.treatment.continuityStrategy} onChange={(value) => updateTreatment("continuityStrategy", value)} />
                <div style={actionRowStyle}>
                  <button type="button" className="btn primary" disabled={!!busy || session.treatmentApproved} onClick={approveTreatment}>
                    {session.treatmentApproved ? "Treatment approved ✓" : "Approve treatment and continue"}
                  </button>
                </div>
              </section>`,
    "treatment approval gate",
  );

  patched = replaceRequired(
    patched,
    `              <section style={sectionStyle}>
                <h3 style={sectionTitleStyle}>3. Character bible</h3>
                <label style={fieldStyle}>
                  <span>Primary conditioning asset</span>
                  <select value={session.plan.characterBible.referenceId ?? ""} onChange={(event) => updateCharacterBible("referenceId", event.target.value || null)} style={inputStyle}>
                    <option value="">No asset selected</option>
                    {referenceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <Field label="Reference summary" value={session.plan.characterBible.referenceSummary} onChange={(value) => updateCharacterBible("referenceSummary", value)} />
                <Field label="Immutable traits" value={session.plan.characterBible.immutableTraits.join("\n")} onChange={(value) => updateCharacterBible("immutableTraits", value.split("\n").filter(Boolean))} />
                <Field label="Wardrobe lock" value={session.plan.characterBible.wardrobe} onChange={(value) => updateCharacterBible("wardrobe", value)} />
                <Field label="Prohibited changes" value={session.plan.characterBible.prohibitedChanges.join("\n")} onChange={(value) => updateCharacterBible("prohibitedChanges", value.split("\n").filter(Boolean))} />
              </section>`,
    `              {session.treatmentApproved ? (
                <section style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>3. Character bible {session.characterBibleApproved ? "✓" : ""}</h3>
                  <label style={fieldStyle}>
                    <span>Primary conditioning asset</span>
                    <select value={session.plan.characterBible.referenceId ?? ""} onChange={(event) => updateCharacterBible("referenceId", event.target.value || null)} style={inputStyle}>
                      <option value="">No asset selected</option>
                      {referenceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <Field label="Reference summary" value={session.plan.characterBible.referenceSummary} onChange={(value) => updateCharacterBible("referenceSummary", value)} />
                  <Field label="Immutable traits" value={session.plan.characterBible.immutableTraits.join("\n")} onChange={(value) => updateCharacterBible("immutableTraits", value.split("\n").filter(Boolean))} />
                  <Field label="Wardrobe lock" value={session.plan.characterBible.wardrobe} onChange={(value) => updateCharacterBible("wardrobe", value)} />
                  <Field label="Prohibited changes" value={session.plan.characterBible.prohibitedChanges.join("\n")} onChange={(value) => updateCharacterBible("prohibitedChanges", value.split("\n").filter(Boolean))} />
                  <div style={actionRowStyle}>
                    <button type="button" className="btn primary" disabled={!!busy || session.characterBibleApproved} onClick={approveCharacterBible}>
                      {session.characterBibleApproved ? "Character bible approved ✓" : "Approve character bible and continue"}
                    </button>
                  </div>
                </section>
              ) : (
                <section style={{ ...sectionStyle, opacity: .5 }}>
                  <h3 style={sectionTitleStyle}>3. Character bible · Locked</h3>
                  <div style={blockingStyle}>Approve the treatment before reviewing character continuity.</div>
                </section>
              )}`,
    "character bible approval gate",
  );

  patched = replaceRequired(
    patched,
    `              <section style={sectionStyle}>
                <h3 style={sectionTitleStyle}>4. Clip-by-clip LTX instructions</h3>
                <p style={helpStyle}>Every field is editable. Prompts have no UI character limit; LTX performs best when the final prompt stays below 200 words.</p>
                <div style={shotGridStyle}>
                  {session.plan.shots.map((shot) => {
                    const promptWords = words(shot.prompt);
                    const conditioningReady = !shot.requiresCharacter || Boolean(resolveReferenceUrl(shot.conditioningReferenceId));
                    return (
                      <article key={shot.clipId} style={{ ...shotCardStyle, borderColor: conditioningReady ? "rgba(255,255,255,.13)" : "rgba(239,68,68,.65)" }}>
                        <div style={shotHeaderStyle}>
                          <strong>{shot.sectionLabel}</strong>
                          <span style={smallStyle}>{formatTime(shot.start)}–{formatTime(shot.end)} · {shot.clipId}</span>
                        </div>
                        <Field label="Section label" value={shot.sectionLabel} onChange={(value) => updateShot(shot.clipId, { sectionLabel: value })} singleLine />
                        <label style={checkStyle}>
                          <input type="checkbox" checked={shot.requiresCharacter} onChange={(event) => updateShot(shot.clipId, {
                            requiresCharacter: event.target.checked,
                            conditioningReferenceId: event.target.checked
                              ? shot.conditioningReferenceId ?? session.plan?.characterBible.referenceId ?? null
                              : shot.conditioningReferenceId,
                          })} />
                          <span>Principal character appears in this clip</span>
                        </label>
                        <label style={fieldStyle}>
                          <span>Conditioning asset</span>
                          <select value={shot.conditioningReferenceId ?? ""} onChange={(event) => updateShot(shot.clipId, { conditioningReferenceId: event.target.value || null })} style={inputStyle}>
                            <option value="">Text-only shot</option>
                            {referenceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        {!conditioningReady && <div style={blockingStyle}>Blocked: this character shot has no usable image condition.</div>}
                        <Field label="LTX-2.3 prompt" value={shot.prompt} onChange={(value) => updateShot(shot.clipId, { prompt: value })} tall />
                        <div style={{ ...countStyle, color: promptWords > 200 ? "#fca5a5" : "#a1a1aa" }}>{shot.prompt.length.toLocaleString()} characters · {promptWords} words · no UI limit</div>
                        <Field label="Continuity notes" value={shot.continuityNotes} onChange={(value) => updateShot(shot.clipId, { continuityNotes: value })} />
                        <Field label="Transition" value={shot.transition} onChange={(value) => updateShot(shot.clipId, { transition: value })} />
                      </article>
                    );
                  })}
                </div>
                <div style={actionRowStyle}>
                  <button type="button" className="btn primary" disabled={!!busy} onClick={validateAndApplyPlan}>
                    {session.planAccepted ? "Plan attached ✓" : "Accept edited plan and build timeline"}
                  </button>
                  <button type="button" className="btn" disabled={!!busy} onClick={startProduction}>Start conditioned LTX production</button>
                  {clipProgress.failed > 0 && <button type="button" className="btn" onClick={retryFailed}>Retry failed clips</button>}
                </div>
              </section>`,
    `              {session.characterBibleApproved ? (
                <section style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>4. Approve analyzed song sections in order</h3>
                  <p style={helpStyle}>Only the current song section is unlocked. Editing an approved section revokes its approval and every later section approval.</p>
                  <div style={actionRowStyle}>
                    {approvalSections.map((section, index) => {
                      const approved = approvedSectionKeySet.has(section.key);
                      const unlocked = index <= maxUnlockedSectionIndex;
                      return (
                        <button
                          key={section.key}
                          type="button"
                          className={approved ? "btn" : index === visibleSectionIndex ? "btn primary" : "btn ghost"}
                          disabled={!unlocked || !!busy}
                          onClick={() => updateSession({ activeSectionIndex: index })}
                        >
                          {approved ? "✓ " : ""}{index + 1}. {section.label}
                        </button>
                      );
                    })}
                  </div>

                  {activeApprovalSection && (
                    <>
                      <div style={modelBadgeStyle}>
                        Section {visibleSectionIndex + 1} of {approvalSections.length} · {activeApprovalSection.label} · {formatTime(activeApprovalSection.start)}–{formatTime(activeApprovalSection.end)}
                      </div>
                      <div style={shotGridStyle}>
                        {activeApprovalSection.shots.map((shot) => {
                          const promptWords = words(shot.prompt);
                          const conditioningReady = !shot.requiresCharacter || Boolean(resolveReferenceUrl(shot.conditioningReferenceId));
                          return (
                            <article key={shot.clipId} style={{ ...shotCardStyle, borderColor: conditioningReady ? "rgba(255,255,255,.13)" : "rgba(239,68,68,.65)" }}>
                              <div style={shotHeaderStyle}>
                                <strong>{shot.sectionLabel}</strong>
                                <span style={smallStyle}>{formatTime(shot.start)}–{formatTime(shot.end)} · {shot.clipId}</span>
                              </div>
                              <Field label="Section label" value={shot.sectionLabel} onChange={(value) => updateShot(shot.clipId, { sectionLabel: value })} singleLine />
                              <label style={checkStyle}>
                                <input type="checkbox" checked={shot.requiresCharacter} onChange={(event) => updateShot(shot.clipId, {
                                  requiresCharacter: event.target.checked,
                                  conditioningReferenceId: event.target.checked
                                    ? shot.conditioningReferenceId ?? session.plan?.characterBible.referenceId ?? null
                                    : shot.conditioningReferenceId,
                                })} />
                                <span>Principal character appears in this clip</span>
                              </label>
                              <label style={fieldStyle}>
                                <span>Conditioning asset</span>
                                <select value={shot.conditioningReferenceId ?? ""} onChange={(event) => updateShot(shot.clipId, { conditioningReferenceId: event.target.value || null })} style={inputStyle}>
                                  <option value="">Text-only shot</option>
                                  {referenceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                                </select>
                              </label>
                              {!conditioningReady && <div style={blockingStyle}>Blocked: this character shot has no usable image condition.</div>}
                              <Field label="LTX-2.3 prompt" value={shot.prompt} onChange={(value) => updateShot(shot.clipId, { prompt: value })} tall />
                              <div style={{ ...countStyle, color: promptWords > 200 ? "#fca5a5" : "#a1a1aa" }}>{shot.prompt.length.toLocaleString()} characters · {promptWords} words · no UI limit</div>
                              <Field label="Continuity notes" value={shot.continuityNotes} onChange={(value) => updateShot(shot.clipId, { continuityNotes: value })} />
                              <Field label="Transition" value={shot.transition} onChange={(value) => updateShot(shot.clipId, { transition: value })} />
                            </article>
                          );
                        })}
                      </div>
                      <div style={actionRowStyle}>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!!busy || approvedSectionKeySet.has(activeApprovalSection.key)}
                          onClick={approveActiveSongSection}
                        >
                          {approvedSectionKeySet.has(activeApprovalSection.key)
                            ? \`\${activeApprovalSection.label} approved ✓\`
                            : visibleSectionIndex === approvalSections.length - 1
                              ? \`Approve \${activeApprovalSection.label} and finish review\`
                              : \`Approve \${activeApprovalSection.label} and continue\`}
                        </button>
                      </div>
                    </>
                  )}

                  {allSectionsApproved && (
                    <div style={{ ...statusBoxStyle, marginTop: 18, border: "1px solid rgba(34,197,94,.3)", borderRadius: 12 }}>
                      <div style={statusHeaderStyle}><span>All analyzed song sections approved</span><strong>{approvalSections.length}/{approvalSections.length}</strong></div>
                      <div style={actionRowStyle}>
                        <button type="button" className="btn primary" disabled={!!busy} onClick={validateAndApplyPlan}>
                          {session.planAccepted ? "Approved plan attached ✓" : "Build timeline from approved sections"}
                        </button>
                        <button type="button" className="btn" disabled={!!busy || !session.planAccepted} onClick={startProduction}>Start conditioned LTX production</button>
                        {clipProgress.failed > 0 && <button type="button" className="btn" onClick={retryFailed}>Retry failed clips</button>}
                      </div>
                    </div>
                  )}
                </section>
              ) : (
                <section style={{ ...sectionStyle, opacity: .5 }}>
                  <h3 style={sectionTitleStyle}>4. Song section approvals · Locked</h3>
                  <div style={blockingStyle}>Approve the character bible before reviewing the first analyzed song section.</div>
                </section>
              )}`,
    "sequential analyzed song section approvals",
  );

  return patched;
}
