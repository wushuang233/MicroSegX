package com.microsegx.web

import com.microsegx.api.Api
import com.microsegx.core.BootedCore
import com.microsegx.core.Core
import com.microsegx.core.CoreActors

object Rest extends App with BootedCore with Core with CoreActors with Api with StaticResources
