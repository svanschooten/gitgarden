#!/bin/sh

set -e

echo "Enter the target repository URL:"
read -r TARGET_REPO_URL

if [ -z "$TARGET_REPO_URL" ]; then
    echo "Error: Target repository URL cannot be empty"
    exit 1
fi

echo "Validating target repository..."
if git ls-remote "$TARGET_REPO_URL" HEAD >/dev/null 2>&1; then
    echo "✓ Repository exists and is accessible"
else
    echo "✗ Error: Target repository does not exist or is not accessible, please check the URL and your permissions"
    exit 1
fi

GITGARDEN_REPO_PATH="$(cd "$(dirname "$0")" && pwd)"
export GITGARDEN_TARGET="$TARGET_REPO_URL"
export GITGARDEN_REPO_PATH

SHELL_CONFIG=""
if [ -n "$BASH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.bashrc"
elif [ -n "$ZSH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
else
    SHELL_CONFIG="$HOME/.profile"
fi

if ! grep -q "export GITGARDEN_TARGET=" "$SHELL_CONFIG" 2>/dev/null; then
    {
        echo ""
        echo "# GitGarden target repository"
        echo "export GITGARDEN_TARGET=\"$TARGET_REPO_URL\""
    } >> "$SHELL_CONFIG"
    echo "✓ Added GITGARDEN_TARGET to $SHELL_CONFIG"
else
    sed -i.bak "s|export GITGARDEN_TARGET=.*|export GITGARDEN_TARGET=\"$TARGET_REPO_URL\"|" "$SHELL_CONFIG"
    echo "✓ Updated GITGARDEN_TARGET in $SHELL_CONFIG"
fi

if ! grep -q "export GITGARDEN_REPO_PATH=" "$SHELL_CONFIG" 2>/dev/null; then
    {
        echo "export GITGARDEN_REPO_PATH=\"$GITGARDEN_REPO_PATH\""
    } >> "$SHELL_CONFIG"
    echo "✓ Added GITGARDEN_REPO_PATH to $SHELL_CONFIG"
else
    sed -i.bak "s|export GITGARDEN_REPO_PATH=.*|export GITGARDEN_REPO_PATH=\"$GITGARDEN_REPO_PATH\"|" "$SHELL_CONFIG"
    echo "✓ Updated GITGARDEN_REPO_PATH in $SHELL_CONFIG"
fi

git config --global init.templatedir "$PWD/.git_template"

echo "Git template directory configured successfully"
echo ""
echo "GITGARDEN_TARGET set to: $TARGET_REPO_URL"
echo "Please restart your shell or run: source $SHELL_CONFIG"