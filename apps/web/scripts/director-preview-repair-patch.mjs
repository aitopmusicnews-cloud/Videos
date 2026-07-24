export function repairDirectorPreviewPatch(source, replaceRequired) {
  let patched = source;

  patched = replaceRequired(
    patched,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => {`,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => {`,
    "character editor function boundary",
  );

  patched = replaceRequired(
    patched,
    `  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {`,
    `  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {`,
    "shot editor function boundary",
  );

  patched = replaceRequired(
    patched,
    `  const resolveReferenceUrl = (referenceId: string | null): string => {  const resolveReferenceUrl = (referenceId: string | null): string => {`,
    `  const resolveReferenceUrl = (referenceId: string | null): string => {`,
    "reference resolver function boundary",
  );

  patched = replaceRequired(
    patched,
    `  const approveActiveSongSection = () => {  const approveActiveSongSection = () => {`,
    `  const approveActiveSongSection = () => {`,
    "section approval function boundary",
  );

  patched = replaceRequired(
    patched,
    `  const validateAndApplyPlan = (): boolean => {  const validateAndApplyPlan = (): boolean => {`,
    `  const validateAndApplyPlan = (): boolean => {`,
    "timeline validation function boundary",
  );

  patched = replaceRequired(
    patched,
    `const SESSION_VERSION = 1;`,
    `const SESSION_VERSION = 2;`,
    "reset legacy Director sessions without required previews",
  );

  patched = replaceRequired(
    patched,
    `      if (detail?.kind === "character" && detail.url) setCharacter(detail.url);
      setReferenceRevision((value) => value + 1);
      setOpen(true);`,
    `      if (detail?.kind === "character" && detail.url) {
        setCharacter(detail.url);
        setSession((current) => ({
          ...current,
          characterBibleApproved: false,
          treatmentApproved: false,
          approvedSectionKeys: [],
          activeSectionIndex: 0,
          stylePreviewUrl: null,
          sectionPreviewUrls: {},
          planAccepted: false,
        }));
      }
      setReferenceRevision((value) => value + 1);
      setOpen(true);`,
    "invalidate previews when the character reference changes",
  );

  patched = replaceRequired(
    patched,
    `      setSession((current) => ({
        ...current,
        sectionPreviewUrls: { ...current.sectionPreviewUrls, [section.key]: outputUrl },
        approvedSectionKeys: current.approvedSectionKeys.filter((key) => key !== section.key),
        planAccepted: false,
      }));`,
    `      const sectionIndex = approvalSections.findIndex((item) => item.key === section.key);
      const retainedKeys = new Set(
        approvalSections.slice(0, Math.max(0, sectionIndex)).map((item) => item.key),
      );
      setSession((current) => ({
        ...current,
        sectionPreviewUrls: {
          ...Object.fromEntries(Object.entries(current.sectionPreviewUrls).filter(([key]) => retainedKeys.has(key))),
          [section.key]: outputUrl,
        },
        approvedSectionKeys: current.approvedSectionKeys.filter((key) => retainedKeys.has(key)),
        activeSectionIndex: sectionIndex >= 0 ? sectionIndex : current.activeSectionIndex,
        planAccepted: false,
      }));`,
    "invalidate current and later approvals after preview regeneration",
  );

  patched = replaceRequired(
    patched,
    `    if (!session.treatmentApproved || !session.characterBibleApproved || !allSectionsApproved) {`,
    `    if (
      !session.characterBibleApproved ||
      !session.treatmentApproved ||
      !session.stylePreviewUrl ||
      !allSectionsApproved ||
      approvalSections.some((section) => !session.sectionPreviewUrls[section.key])
    ) {`,
    "require persisted previews before timeline build",
  );

  return patched;
}
