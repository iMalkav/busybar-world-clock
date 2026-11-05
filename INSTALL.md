# Installation

Build the app with the commands in README.md, or obtain its .tgz release package.
Connect the BUSY Bar over USB and run pnpm app:install from this project.
Then use pnpm app:run, or choose the app from the device Apps menu.

For a different device address use:

    corepack pnpm app:install --addr <host>
    corepack pnpm app:run --addr <host>

Wi-Fi access must be enabled in the device web interface. Add --password when password protection is enabled.
Installation does not build the source; run pnpm build first after making changes.
App commands select a device; release builds connect to localhost on the device.
