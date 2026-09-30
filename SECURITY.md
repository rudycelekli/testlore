# Security

For a vulnerability involving path traversal, worker output, or command execution, use GitHub's private vulnerability reporting if available, or contact the repository maintainer privately through their GitHub profile. Do not post credentials or exploit details publicly before coordination.

The deterministic CLI executes only the runner configured by the project when `run` is requested. That runner and custom agent executables have the caller's permissions. Only `generate --execute` invokes agent workers. Review source before passing it to remote workers; source can contain embedded secrets despite filename filtering. Staging avoids automatic execution and overwriting, but does not make generated code trustworthy.

This is an experimental project. See the documented discovery, static dependency, sandbox, and provider boundaries before using selection in a deployment pipeline.
