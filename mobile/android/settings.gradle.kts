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

// Obliance.
include(":obliance:domain")

// Phase 0 technical proofs (design doc §11): compiled and tested, never shipped.
include(":proofs")
