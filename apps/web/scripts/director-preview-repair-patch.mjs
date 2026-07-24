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

  return patched;
}
