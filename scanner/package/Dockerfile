ARG VULNDB_VERSION=4.122
ARG VULNDB_CHECKSUM=ae6e64d9a9f151ab301d52d805bf215841561dc8475dd45a755d68b8040ef1fb
ARG SIGSTORE_VERSION=fe81b963bb01c53cc7664d4b6cb04afa2a9ed748
#
# Builder
#
FROM registry.suse.com/bci/golang:1.25 AS builder
ARG VERSION
ARG VULNDB_CHECKSUM
ARG SIGSTORE_VERSION

ENV HTTP_PROXY= \
    HTTPS_PROXY= \
    ALL_PROXY= \
    http_proxy= \
    https_proxy= \
    all_proxy=

RUN unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy && \
    zypper in -y wget

# Build controller
COPY common/ /src/common
COPY cvetools/ /src/cvetools
COPY data/ /src/data
COPY detectors/ /src/detectors
COPY monitor/ /src/monitor
COPY task/ /src/task
COPY vendor/ /src/vendor
COPY Makefile go.mod go.sum *.go genlic.sh /src/

WORKDIR /src
RUN git clone https://github.com/microsegx/sigstore-interface --single-branch sigstore-interface && cd sigstore-interface && git checkout ${SIGSTORE_VERSION} && make
RUN if [ -f "data/cvedb.regular" ]; then echo "using cvedb.regular"; echo "$VULNDB_CHECKSUM data/cvedb.regular" | sha256sum --check --status; else echo "using cvedb"; cp "data/cvedb" "data/cvedb.regular"; fi
RUN make slsa_all

#
# Base images
#
FROM registry.suse.com/bci/bci-micro:15.7 AS micro
FROM registry.suse.com/bci/bci-base:15.7 AS base

ENV HTTP_PROXY= \
    HTTPS_PROXY= \
    ALL_PROXY= \
    http_proxy= \
    https_proxy= \
    all_proxy=

COPY --from=micro / /chroot/
RUN unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy && \
  zypper refresh && zypper --installroot /chroot -n in --no-recommends \
  ca-certificates procps grep && \
  zypper --installroot /chroot clean -a && \
  rm -rf /chroot/var/log/

RUN cd /chroot/usr/bin/ && rm -rf basename chcon chgrp chmod chown chroot cksum dd df dircolors dirname du install install-info join locale localedef mkdir mkfifo mknod mktemp paste pathchk readlink realpath sync smidiff smidump smilink smiquery smistrip smixlate tee tiemout tload top truncate unlink watch

RUN mkdir -p /chroot/etc/microsegx/certs/internal/ && mkdir -p /chroot/share && touch /chroot/share/.nvcontainer
RUN chmod 770 /chroot/etc/microsegx/certs/internal/

#
# Artifact
#
FROM micro
WORKDIR /
COPY --from=base /chroot/ /
COPY --from=builder /src/stage /

ARG COMMIT
ARG VERSION
ARG VULNDB_VERSION
ARG SIGSTORE_VERSION

LABEL name="scanner" \
  vendor="SUSE Security" \
  version=${VERSION} \
  release=${VERSION} \
  microsegx.image="microsegx/scanner" \
  microsegx.role="scanner" \
  microsegx.rev="${COMMIT}" \
  microsegx.vuln_db="${VULNDB_VERSION}" \
  microsegx.sigstore="${SIGSTORE_VERSION}" \
  "io.artifacthub.package.logo-url"=https://avatars2.githubusercontent.com/u/19367275 \
  "io.artifacthub.package.readme-url"="https://raw.githubusercontent.com/microsegx/scanner/${VERSION}/README.md" \
  "org.opencontainers.image.description"="SUSE Security Scanner" \
  "org.opencontainers.image.title"="SUSE Security Scanner" \
  "org.opencontainers.image.source"="https://github.com/microsegx/scanner/" \
  "org.opencontainers.image.version"="${VERSION}" \
  "org.opensuse.reference"="microsegx/scanner:${VERSION}"

ENTRYPOINT ["/usr/local/bin/monitor"]
