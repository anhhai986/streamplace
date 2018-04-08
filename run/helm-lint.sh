#!/bin/bash

set -o errexit
set -o nounset
set -o pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/.. && pwd )"
source "$ROOT/run/common.sh"

info "Linting $PACKAGE_NAME"

# Check to make sure all versions are correct
correctVersion=$(cat $ROOT/lerna.json | jq -r '.version')
correctName="$PACKAGE_NAME"
correctIcon="https://charts.stream.place/icon.svg"

if [[ -f "package.json" ]]; then
  oldPackage="$(cat package.json)"
  newPackage="$oldPackage"
  packageVersion=$(echo $newPackage | jq -r .version)
  packageName=$(echo $newPackage | jq -r .name)
  if [[ "$packageVersion" != "$correctVersion" ]]; then
    fixOrErr "$PACKAGE_NAME: package.json has version $packageVersion instead of $correctVersion"
    newPackage=$(tweak "$newPackage" ".version" "$correctVersion")
  fi
  if [[ "$packageName" != "$correctName" ]]; then
    fixOrErr "$correctName: package.json has name $packageName instead of $correctName"
    newPackage=$(tweak "$newPackage" ".name" "$correctName")
  fi
  if [[ "$oldPackage" != "$newPackage" ]]; then
    echo "$newPackage" > package.json
  fi
fi

if [[ -f "Dockerfile" ]]; then
  if [[ ! -f .dockerignore ]]; then
    fixOrErr "$PACKAGE_NAME has no .dockerignore"
    touch .dockerignore
  fi
  requiredIgnores='node_modules /*.tgz'
  for ignore in $requiredIgnores; do
    result=$(cat .dockerignore | grep $ignore || echo "")
    if [[ "$result" == "" ]]; then
      fixOrErr ".dockerignore is missing $ignore"
      echo "$ignore" >> .dockerignore
    fi
  done
fi

if [[ -f "Chart.yaml" ]]; then
  newChart="$(cat Chart.yaml | js-yaml)"
  chartVersion="$(echo $newChart | jq -r .version)"
  chartName="$(echo $newChart | jq -r .name)"
  chartIcon="$(echo $newChart | jq -r .icon)"

  if [[ "$chartVersion" != "$correctVersion" ]]; then
    fixOrErr "$correctName: Chart.yaml has version $chartVersion instead of $correctVersion"
    newChart=$(tweak "$newChart" ".version" "$correctVersion")
  fi

  if [[ "$chartName" != "$correctName" ]]; then
    fixOrErr "$correctName: Chart.yaml has name $chartName instead of $correctName"
    newChart=$(tweak "$newChart" ".name" "$correctName")
  fi

  if [[ "$chartIcon" != "$correctIcon" ]]; then
    fixOrErr "$correctName: Chart.yaml has icon $chartIcon instead of $correctIcon"
    newChart=$(tweak "$newChart" ".icon" "$correctIcon")
  fi

  if [[ -f "package.json" ]]; then
    packageDesc="$(cat package.json | jq -r .description)"
    chartDesc="$(echo $newChart | jq -r ".description")"
    if [[ "$packageDesc" != "$chartDesc" ]]; then
      fixOrErr "$correctName Chart.yaml and package.json have different descriptions"
      newChart=$(tweak "$newChart" ".description" "$packageDesc")
    fi
  fi
  # Echo -n 'cuz js-yaml adds its own newline
  echo -n "$newChart" | js-yaml > Chart.yaml

  # Validate requirements.yaml has the right versions
  if [[ -f "requirements.yaml" ]]; then
    requirementsJson="$(js-yaml requirements.yaml)"
    if echo "$requirementsJson" | jq -r '.dependencies[].version' | grep -v "$correctVersion" > /dev/null; then
      fixOrErr "requirements.yaml has the wrong package versions"
      requirementsJson="$(echo "$requirementsJson" | jq ".dependencies = (.dependencies | map(.version = \"$correctVersion\"))")"
      echo -n "$requirementsJson" | js-yaml > requirements.yaml
    fi
  fi


  if [[ ! -f .helmignore ]]; then
    fixOrErr "$PACKAGE_NAME has no .helmignore"
    touch .helmignore
  fi
  requiredIgnores='node_modules /*.tgz package.json dist src public Dockerfile build'
  for ignore in $requiredIgnores; do
    result=$(cat .helmignore | grep $ignore || echo "")
    if [[ "$result" == "" ]]; then
      fixOrErr ".helmignore is missing $ignore"
      echo "$ignore" >> .helmignore
    fi
  done
fi

if [[ ! -f .npmignore ]]; then
  fixOrErr "$PACKAGE_NAME has no .npmignore"
  touch .npmignore
fi
requiredIgnores='src templates Chart.yaml requirements.yaml'
for ignore in $requiredIgnores; do
  result=$(cat .npmignore | grep $ignore || echo "")
  if [[ "$result" == "" ]]; then
    fixOrErr ".npmignore is missing $ignore"
    echo "$ignore" >> .npmignore
  fi
done

# Have helm lint the chart after we're cool with our linting of it
if [[ -f "Chart.yaml" ]]; then
  log "Running helm lint ."
  helm lint .
fi
