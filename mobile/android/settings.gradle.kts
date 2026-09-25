pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "obli-shell-android"

include(":app")

// Platform, app-agnostic: no Obliance type may appear here (design doc §10.2).
include(":core:common")
include(":core:model")
include(":core:network")
include(":core:auth")
include(":core:designsystem")
include(":core:realtime")
include(":core:security")
include(":core:data")
// Action host (S41–S44 prompts, biometric, results) and the S90 web view.
include(":core:security-ui")
include(":core:webfallback")

// Obliance.
include(":obliance:domain")
// Native Obliance alpha (design doc §10.2): plumbing, screens, application.
include(":obliance:api")
include(":obliance:data")
include(":obliance:access")
include(":obliance:triage")
include(":obliance:devices")
include(":obliance:fleet")
include(":obliance:more")
include(":obliance:app")

// Phase 0 technical proofs (design doc §11): compiled and tested, never shipped.
include(":proofs")
