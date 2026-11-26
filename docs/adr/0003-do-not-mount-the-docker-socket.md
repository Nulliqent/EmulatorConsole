---
status: accepted
---

# Do not mount the Docker socket

The Console connects to one Emulator and never starts, stops or resets it. Access to the Docker socket is effectively root on the host, which is too much authority for a restart button, so after a restart the Console reports that state was lost and shows the command to run.
