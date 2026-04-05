package com.microsegx.api

import com.microsegx.service.DefaultJsonFormats
import org.apache.pekko.http.scaladsl.server.Directives

trait BaseApi extends Directives with DefaultJsonFormats {}
