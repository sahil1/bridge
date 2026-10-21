plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.bridgeai.phone"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.bridgeai.phone"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "2.2.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // Scans the pairing QR code; works without Google Play services.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    // ...which uses androidx.core without bringing it.
    implementation("androidx.core:core:1.13.1")
}
