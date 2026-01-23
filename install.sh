#!/bin/sh

set -e

echo "Enter the repository URL:"
read -r REPO_URL

if [ -z "$REPO_URL" ]; then
    echo "Error: Repository URL cannot be empty"
    exit 1
fi

echo "Validating repository..."
if git ls-remote "$REPO_URL" HEAD >/dev/null 2>&1; then
    echo "✓ Repository exists and is accessible"
else
    echo "✗ Error: Repository does not exist or is not accessible, please check the URL and your permissions"
    exit 1
fi

export GITGARDEN_TARGET="$REPO_URL"
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
        echo "export GITGARDEN_TARGET=\"$REPO_URL\""
    } >> "$SHELL_CONFIG"
    echo "✓ Added GITGARDEN_TARGET to $SHELL_CONFIG"
else
    sed -i.bak "s|export GITGARDEN_TARGET=.*|export GITGARDEN_TARGET=\"$REPO_URL\"|" "$SHELL_CONFIG"
    echo "✓ Updated GITGARDEN_TARGET in $SHELL_CONFIG"
fi

git config --global init.templatedir "$PWD/.git_template"

echo "Git template directory configured successfully"
echo ""
echo "GITGARDEN_TARGET set to: $REPO_URL"
echo "Please restart your shell or run: source $SHELL_CONFIG"