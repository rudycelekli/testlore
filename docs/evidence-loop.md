# The historical evidence loop

TestLore can record a signed local observation, challenge the claims that observation supports, and retain an attributed review as an advisory lesson. This is historical test evidence. It does not monitor production, verify the revision of a live server, authorize deployment, or demonstrate that learning improved results.

The normal native runner remains responsible for discovery and execution. `observe` invokes the existing shadow runner, which runs the full discovered suite and captures the proposed routing comparison. It registers the expected observation before execution, so an interrupted attempt remains visible as missing evidence. The deadline describes the expected evidence window; it does not install a background monitor or guarantee termination of a stuck runner.

## Establish trust separately

```sh
# Use an existing directory outside the repository for retained trust material.
testlore witness-init --output /absolute/external/trust/recorder.pem --json

testlore observe --revision reviewed-commit-sha --query "checkout contract" --base HEAD \
  --deadline-ms 60000 --output /absolute/external/trust/checkpoint-001.json --json

testlore loop-status --trusted-key /absolute/external/trust/recorder.pem \
  --checkpoint /absolute/external/trust/checkpoint-001.json --json
```

`witness-init` creates a recorder private key at `.tddswarm/loop/private.pem` with mode `0600` and exports the public PEM to the explicit output path. It never overwrites that output. Keep the public key independently and supply it explicitly when validating history. A key recovered from the same untrusted history is not an independent trust anchor. `loop-status` without a supplied trusted key returns an invalid result.

Signatures authenticate the recorder only. They do not prove that the recorder, project runner, local filesystem, host clock, or operator is honest. Anyone with the private key can author signed history. Keep `.tddswarm/` out of source control and do not share its private key.

The revision is a mandatory operator-declared label, such as a reviewed Git commit SHA. It is not an observation of a production server's serving revision. Do not interpret a matching label as verified deployment identity.

`observe --output` exports the returned `{sequence, hash, keyId}` checkpoint as JSON without overwriting a file. Store each checkpoint outside the repository and retain it independently. A trusted retained checkpoint makes removal of history at or before that checkpoint detectable. Without a checkpoint, removal of an otherwise valid signed suffix is undetectable. A checkpoint cannot protect later records that were never independently retained.

Relative public-key and checkpoint paths resolve against `--root` (or the current directory). These explicit paths may be outside the repository. Output parent directories must already exist.

## Challenge claims and record reviews

```sh
testlore challenge --id observation-uuid --claim observed-pass \
  --trusted-key /absolute/external/trust/recorder.pem --json

testlore outcome --id observation-uuid --claim observed-pass \
  --verdict accepted --reviewer 'local operator: Casey' \
  --trusted-key /absolute/external/trust/recorder.pem --json

testlore outcome-lessons --query 'shared source changes' \
  --trusted-key /absolute/external/trust/recorder.pem --json
```

Use the UUID returned by `observe` for `--id`. Every validation command accepts `--checkpoint` to compare against a separately retained checkpoint. A challenge can assess `observed-pass` and `no-observed-routing-miss` within the captured observation's scope. It does not infer exhaustive defect detection from a passing suite. `deployment-safe` and `learning-gain` are deliberately unsupported by this evidence.

An outcome records `accepted` or `rejected` with explicit reviewer attribution. The reviewer string is operator asserted; TestLore does not authenticate a human reviewer or establish that the operator is independent of the recorder. An attributed outcome is not independent proof of correctness.

`outcome-lessons` retrieves only reviewed outcomes, as advisory history. It grants no deployment authority and does not silently revise mappings, rewrite tests, or change native runner policy. The optional `--query` on `observe` supplies a bounded topic label (up to 200 characters), useful when matching future contracts. It is operator-declared context, not an independent specification.

To pass relevant reviewed outcomes into the existing architect/author learning context, explicitly configure independently retained trust material:

```json
{
  "learning": {
    "outcomes": {
      "trustedKey": "/absolute/external/trust/recorder.pem",
      "checkpoint": "/absolute/external/trust/checkpoint-001.json"
    }
  }
}
```

`recall` and generation then include bounded `reviewedOutcomes` matching the query and current contract topic. Each retains its evidence ID, historical/advisory labels and source compatibility. Corrupt history supplies no outcome lessons. Candidate examples and reviewed outcomes share the caller's response budget. Outcome feedback never changes routing policy or independent reviewer authority. `learning.enabled: false` disables both memories.

## Inspection and automation boundaries

`loop-status`, `challenge`, and `outcome-lessons` are read-only and do not invoke project code. `outcome` appends a signed review but does not run tests. Only `observe` executes the project runner. The MCP toolset is unchanged.

Inspection `complete` means every registered attempt has a recorded receipt; a failed, incomplete, or not-started test observation can still have a complete recorder history. Check each attempt's status and challenge the desired claim before treating it as passing evidence.

Use `--json` for complete structured results. CLI exit status is zero for a supported challenge, one for an unsupported challenge, and two for invalid or incomplete history inspection. `observe` preserves a nonzero runner exit code; an observation without a completed successful result is not a pass. Unsupported command options are rejected rather than interpreted as authority.
