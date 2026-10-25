import evaluation from './receiving2026Validation.json' with { type: 'json' };
import { correctedReceivingReadiness } from './correctedReceiving.ts';

export async function receivingValidationReport() {
  const model = await correctedReceivingReadiness();
  const verified = model.artifactVerified
    && model.artifactSha256 === evaluation.artifactSha256
    && model.canonicalArtifactSha256 === evaluation.canonicalArtifactSha256;
  return {
    evidenceStatus: verified && evaluation.dataAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
    reason: !verified ? 'ARTIFACT_INTEGRITY_FAILURE'
      : evaluation.dataAvailable ? 'FROZEN_2026_RETROSPECTIVE_EVIDENCE' : '2026_SOURCE_UNAVAILABLE',
    modelIntegrityVerified: verified,
    bettingDecision: 'HOLD',
    liveApproved: false,
    verifiedPositiveEv: false,
    executionEnabled: false,
    evaluation: verified ? evaluation : null,
  };
}
