import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Android bindings of the platform: WebView cookies, DataStore persistence.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "tools.obli.core.data"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    api(project(":core:auth"))
    api(project(":core:network"))
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
}
