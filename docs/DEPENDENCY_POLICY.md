# MERCORA dependency policy

## Objective

Dependencies are part of MERCORA's attack surface. A dependency may not be added solely for convenience when equivalent functionality can be implemented safely with the existing stack.

## Requirements

1. Every production dependency must have a documented purpose.
2. Versions must be reproducible through a lockfile where the ecosystem supports one.
3. Security-sensitive dependencies require additional review before adoption.
4. Transitive dependencies are included in vulnerability review.
5. High or critical known vulnerabilities must be investigated before release; exploitable vulnerabilities must block release unless an explicitly documented risk acceptance exists.
6. Abandoned, unmaintained, or suspicious packages must not be introduced without a documented exception.
7. Dependency updates must be tested for regressions and authorization/security impact.
8. GitHub Actions and other CI dependencies must be pinned to immutable versions before production CI is treated as a trusted security boundary.
9. Secrets, credentials, private keys, wallet seeds, and tokens must never be supplied through dependency configuration committed to the repository.

## Review checklist

- [ ] Purpose and owner identified.
- [ ] License reviewed for the intended use.
- [ ] Direct and transitive dependency impact reviewed.
- [ ] Known vulnerability status checked.
- [ ] Lockfile updated and committed.
- [ ] Tests pass.
- [ ] Security-sensitive behavior reviewed where applicable.

## Release rule

The absence of a detected vulnerability is not proof that a dependency is safe. MERCORA combines automated scanning with human review and threat modeling.
