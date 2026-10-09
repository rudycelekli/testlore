import {installedRepairEvidenceComplete} from './installed-repair-proof.js';
/** Validate the independently produced installed-archive proof, without truthy attestations. */
export function packedEvidenceComplete(receipt, evidence, {proofScriptSha256, sourceManifestSha256, installedRepairProofSha256}) {
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  return receipt.schemaVersion === 1 && receipt.qualified === true && evidence.schemaVersion === 1 &&
    typeof receipt.sourceRevision === 'string' && /^[a-f0-9]{40}$/.test(receipt.sourceRevision) &&
    [receipt.archiveSha256, receipt.packedManifestSha256, proofScriptSha256, sourceManifestSha256].every(hex) &&
    evidence.sha256 === receipt.archiveSha256 && evidence.version === receipt.version &&
    evidence.exactInputArchive === true && evidence.productionInstall === true && evidence.shadowSetupVerified === true && evidence.adoptionInspectionVerified === true &&
    evidence.mcpStdioVerified === true && evidence.mcpShadowVerified === true && evidence.briefInspectionVerified === true &&
    evidence.evidenceLoopVerified === true && evidence.mappingQualificationVerified === true && evidence.actionIdentityVerified === true && evidence.runtimeCaptureComplete === true &&
    evidence.proofScriptSha256 === proofScriptSha256 && receipt.sourceManifestSha256 === sourceManifestSha256 &&
    evidence.packedManifestSha256 === receipt.packedManifestSha256 && receipt.archiveRecipe === 'tracked-source-with-exact-gitHead' &&
    evidence.actionReference === receipt.sourceRevision && evidence.workflowActionReference === receipt.sourceRevision &&
    evidence.nativeShadow?.complete === true && evidence.nativeShadow?.detected === true &&
    Array.isArray(evidence.nativeShadow.selected) && evidence.nativeShadow.selected.length > 0 &&
    Number.isSafeInteger(evidence.nativeShadow.executed) && evidence.nativeShadow.executed > evidence.nativeShadow.selected.length &&
    evidence.improvement?.status === 'ready-for-review' && Number.isSafeInteger(evidence.improvement.cases) &&
    evidence.improvement.cases >= 3 && evidence.improvement.originalBranch === 'main' &&
    installedRepairEvidenceComplete(evidence.installedRepair) && hex(installedRepairProofSha256) &&
    evidence.installedRepair.proofScriptSha256 === installedRepairProofSha256 &&
    evidence.installedRepair.archiveSha256 === receipt.archiveSha256 &&
    evidence.installedRepair.installedManifestSha256 === receipt.packedManifestSha256;
}
