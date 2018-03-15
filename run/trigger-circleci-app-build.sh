#!/bin/bash

set -o pipefail
set -o nounset
set -o errexit

BRANCH="$1"
COMMIT="$2"
SECRETS="/keybase/team/streamplace_team/secrets"

BODY="$(cat << EOF
{
  "build_parameters": {
    "AWS_ACCESS_KEY_ID": "$CRAP_ACCESS_KEY_ID",
    "AWS_DEFAULT_REGION": "us-west-2",
    "AWS_SECRET_ACCESS_KEY": "$CRAP_SECRET_ACCESS_KEY",
    "CERTIFICATE_OSX_P12": "$CERTIFICATE_OSX_P12"
  }
}
EOF
)"

curl \
  -X POST \
  --header "Content-Type: application/json" \
  -d "$BODY" \
  "https://circleci.com/api/v1.1/project/github/streamplace/streamplace/tree/$BRANCH?circle-token=$CIRCLECI_TOKEN"
