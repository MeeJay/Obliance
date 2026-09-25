import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Obliance data layer (design doc §10.4): repositories over :obliance:api, one
// ServerSession per server, exposed to every screen as ObliServices
// (LocalObliServices). Also ships SampleObliServices (§4 reference data) for
// previews and screenshot tests.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "tools.obli.obliance.data"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    api(project(":core:auth"))
    api(project(":core:security"))
    api(project(":obliance:api"))
    api(project(":obliance:domain"))
    api(libs.kotlinx.coroutines.core)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}
