package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	// 创建带日志和异常恢复中间件的 Gin 路由器。
	r := gin.Default()

	// 提供服务运行状态接口。
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "Gin running",
		})
	})

	// 在 8080 端口启动 HTTP 服务。
	if err := r.Run(":8080"); err != nil {
		panic(err)
	}
}
