# Security policy

The tools run locally: they read a game installation, write files inside this repository, and serve the browser runtime on a loopback address (`127.0.0.1`). They are not meant to be exposed to a network.

If you find a vulnerability (for example, a crafted file that makes a tool write outside the repository, or the dev server exposing local files), please report it privately through **GitHub's "Report a vulnerability"** button on the repository's Security tab rather than in a public issue. You will get a response as soon as a maintainer can look at it.

Supported version: the `main` branch.
