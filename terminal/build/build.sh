#!/usr/bin/env bash
# Builds the Linux system that runs in the practice terminal:
#
#   terminal/image/bzImage          32-bit Linux kernel (kernel.config)
#   terminal/image/rootfs.cpio.gz   initramfs: static BusyBox (busybox.config),
#                                   the files in rootfs/ and the practice users
#
# Runs on Ubuntu 24.04, as any user. Install the build dependencies first:
#
#   sudo apt-get install gcc-multilib flex bison bc cpio xz-utils fakeroot \
#     openssl dpkg-dev linux-source-6.8.0
#
# and enable source packages (add "deb-src" to the Types: line in
# /etc/apt/sources.list.d/ubuntu.sources, then apt-get update) so
# `apt-get source busybox` works.

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=$here/../image
work=${WORK_DIR:-$(mktemp -d)}
jobs=$(nproc)
kernel_tarball=/usr/src/linux-source-6.8.0/linux-source-6.8.0.tar.bz2
# Fixed timestamps and password salts keep the image byte-for-byte reproducible.
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-1767225600} # 2026-01-01 00:00 UTC
export KBUILD_BUILD_TIMESTAMP="@$SOURCE_DATE_EPOCH" KBUILD_BUILD_USER=lpi KBUILD_BUILD_HOST=lpi KBUILD_BUILD_VERSION=1

# Applies a Kconfig fragment (CONFIG_X=y / "# CONFIG_X is not set" lines) to .config.
apply_fragment() {
  local fragment=$1 line key
  while IFS= read -r line; do
    case $line in
      CONFIG_*=*) key=${line%%=*} ;;
      "# CONFIG_"*" is not set") key=${line#\# }; key=${key%% *} ;;
      *) continue ;;
    esac
    sed -i "/^$key=/d;/^# $key is not set/d" .config
    echo "$line" >> .config
  done < "$fragment"
}

echo "==> Working in $work"
mkdir -p "$work" "$out"
cd "$work"

echo "==> Kernel"
if [ ! -d linux ]; then
  mkdir linux
  tar -xjf "$kernel_tarball" -C linux --strip-components=1
fi
(
  cd linux
  make -s ARCH=i386 tinyconfig
  apply_fragment "$here/kernel.config"
  make -s ARCH=i386 olddefconfig
  make -s ARCH=i386 -j"$jobs" bzImage
)

echo "==> BusyBox"
if [ ! -d busybox ]; then
  apt-get source --download-only busybox
  dpkg-source -x busybox_*.dsc busybox
fi
(
  cd busybox
  make -s defconfig > /dev/null
  apply_fragment "$here/busybox.config"
  # `yes` dies of SIGPIPE once oldconfig is done; that's expected.
  (set +o pipefail; yes "" | make -s oldconfig > /dev/null)
  make -s -j"$jobs"
)

echo "==> Root file system"
root=$work/rootfs
rm -rf "$root"
mkdir -p "$root"
cp -a "$here/rootfs/." "$root/"
mkdir -p "$root/bin"
cp busybox/busybox "$root/bin/busybox"

fakeroot -- bash -euo pipefail -s "$root" "$out/rootfs.cpio.gz" <<'STAGE'
root=$1 archive=$2
cd "$root"

mkdir -p bin sbin usr/bin usr/sbin usr/local/bin usr/local/sbin etc dev proc sys \
  run tmp root home var/log mnt opt srv media home/student/Downloads
ln -s ../run var/run
ln -s bin/busybox init

# One symlink per BusyBox command, unless rootfs/ already provides a script with that name.
for applet in $(bin/busybox --list-full); do
  [ -e "$applet" ] || [ -L "$applet" ] || ln -s /bin/busybox "$applet"
done

mknod -m 600 dev/console c 5 1
mknod -m 666 dev/null c 1 3

# Passwords: root/root and student/student.
days=$((SOURCE_DATE_EPOCH / 86400))
{
  echo "root:$(openssl passwd -6 -salt lpipracticeroot root):$days:0:99999:7:::"
  for user in daemon bin nobody; do echo "$user:*:$days:0:99999:7:::"; done
  echo "student:$(openssl passwd -6 -salt lpipracticestud student):$days:0:99999:7:::"
} > etc/shadow

chown -R 0:0 .
chown -R 1000:1000 home/student
chmod 755 . bin sbin usr usr/bin usr/sbin etc home var var/log
chmod 4755 bin/busybox # su and passwd need setuid root
chmod 600 etc/shadow
chmod 700 root
chmod 1777 tmp

find . -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
find . | LC_ALL=C sort | cpio --quiet -o -H newc --reproducible | gzip -9n > "$archive"
STAGE

cp linux/arch/x86/boot/bzImage "$out/bzImage"
echo "==> Done"
ls -l "$out"
