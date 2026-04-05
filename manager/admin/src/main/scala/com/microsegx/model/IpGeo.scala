package com.microsegx.model

case class IpGeo(
  from: BigInt,
  to: BigInt,
  country_code: String,
  country_name: String
)

case class IpMap(
  ip_map: Map[String, IpGeo]
)
