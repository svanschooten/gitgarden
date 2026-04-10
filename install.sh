#!/bin/sh

set -e

echo "Installing Git Garden CLI..."

# Install dependencies and link the CLI
npm install
npm link

SHELL_CONFIG=""
if [ -n "$BASH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.bashrc"
elif [ -n "$ZSH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
else
    SHELL_CONFIG="$HOME/.profile"
fi

# Remove old exports if they exist
if [ -f "$SHELL_CONFIG" ]; then
    if grep -q "GITGARDEN_" "$SHELL_CONFIG"; then
        sed -i.bak "/export GITGARDEN_TARGET=/d" "$SHELL_CONFIG"
        sed -i.bak "/export GITGARDEN_REPO_PATH=/d" "$SHELL_CONFIG"
        echo "✓ Cleaned up old Git Garden exports from $SHELL_CONFIG"
    fi
fi

echo "✓ Git Garden CLI installed successfully!"
echo "You can now use 'git-garden install' in any git repository."