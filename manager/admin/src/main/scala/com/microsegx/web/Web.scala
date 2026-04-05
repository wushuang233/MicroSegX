package com.microsegx.web

import com.microsegx.api.Api
import com.microsegx.core.Core
import com.microsegx.core.CoreActors

/**
 * Provides the web server (spray-can) for the REST api in ``Api``, using the actor system defined
 * in ``Core``.
 *
 * Benefits of separate ``ActorSystem`` include the ability to use completely different
 * configuration, especially when it comes to the threading model.
 */
trait Web extends StaticResources with CoreActors with Core with Api
