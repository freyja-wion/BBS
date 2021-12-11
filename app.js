const express = require("express")
const fs = require("fs")
const path = require("path")
const exp = require("constants")
const cookieparser = require("cookie-parser")
const Database = require("better-sqlite3")

const db = new Database(__dirname + "/bbs.sqlite3")
//转译用户发送的数据避免安全问题

const port = 8008
const app = express()
// 引入pug模板
app.set("views", path.join(__dirname, "views"))
app.set("view engine", "pug")
app.locals.pretty = true //让pug输出格式化的html
app.engine("html", require("hbs").__express) //html扩展名的模板使用hbs来render
//__tpl扩展名的模板使用这个函数来转换
app.engine("__tpl", function (filename, data, callback) {
  fs.readFile(filename, (err, content) => {
    if (err) {
      callback(err)
      return
    }
    var tpl = content.toString()
    var i = 0
    var result = tpl.replace(/_+/g, function () {
      return data[i++]
    })
    callback(null, result)
  })
})
app.use(cookieparser("cookie sign secret")) //cookie签名的密码
//解析为json和url的请求体
app.use(express.json())
app.use(express.urlencoded())
//__dirname:当前模块
app.use(express.static(__dirname + "/static"))
//自己写的中间件，可以看到服务器有没有接受到相应的请求
app.use((req, res, next) => {
  console.log(req.method, req.url, req.headers.cookie)
  next()
})
//将用户是否登陆放到req的isLogin字段上的中间件
app.use((req, res, next) => {
  if (req.signedCookies.loginUser) {
    var name = req.signedCookies.loginUser
    req.isLogin = true
    req.loginUser = db.prepare("SELECT * FROM users WHERE name = ?").get(name)
  } else {
    req.isLogin = false
    req.loginUser = null
  }
  next()
})
//主页
app.get("/", (req, res, next) => {
  //读不出数据默认为1
  var page = Number(req.query.page || 1)
  var pageSize = 5
  var totalPost = db.prepare("SELECT count(*) AS total FROM posts").get().total //总页码, 查出post表中所有行的数量
  var totalPage = Math.ceil(totalPost / pageSize)
  var offset = (page - 1) * pageSize
  // var endIdx = startIdx + pageSize
  var pagePosts = db
    .prepare(
      "SELECT * FROM posts JOIN users ON posts.userId = users.userId LIMIT ? OFFSET ?"
    )
    .all(pageSize, offset)
  if (pagePosts.length == 0) {
    res.render("404.pug")
    return
  }
  res.render("home.pug", {
    isLogin: req.isLogin,
    loginUser: req.loginUser,
    posts: pagePosts,
    page: page,
    totalPage: totalPage,
  })
})
//发帖
app
  .route("/post")
  .get((req, res, next) => {
    res.render("issue-post.pug", {
      isLogin: req.isLogin,
      loginUser: req.loginUser,
    })
  })
  .post((req, res, next) => {
    var postInfo = req.body
    var userName = req.signedCookies.loginUser
    if (userName) {
      var user = db.prepare("SELECT * FROM users WHERE name = ?").get(userName)
      //获取时间戳
      postInfo.timestamp = new Date().toISOString()
      //发帖人
      postInfo.userId = user.userId
      var result = db
        .prepare(
          "INSERT INTO posts (title, content, userId, timestamp) VALUES (?,?,?,?)"
        )
        .run(
          postInfo.title,
          postInfo.content,
          postInfo.userId,
          postInfo.timestamp
        )
      //发帖成功后自动跳转
      res.redirect("/post/" + result.lastInsertRowid)
    } else {
      res.end("401 not login")
    }
  })
app.get("/post/:id", (req, res, next) => {
  var postId = req.params.id
  var post = db
    .prepare(
      "SELECT * FROM posts JOIN users ON posts.userId = users.userId WHERE postId = ?"
    )
    .get(postId)
  if (post) {
    //找到帖子对应的评论
    var comments = db
      .prepare(
        "SELECT * FROM comments JOIN users ON comments.userId = users.userId WHERE postId = ?"
      )
      .all(postId)
    res.render("post.pug", {
      isLogin: req.isLogin, //true or false
      loginUser: req.loginUser, //object or null
      comments: comments,
      post: post,
    })
  } else {
    res.render("404.pug")
  }
})
//删除评论 DELETE /comment/5 HTTP/1.1
app.delete("/comment/:id", (req, res, next) => {
  //登录id与评论id相同才能删除
  if (req.loginUser.userId !== req.params.id) {
    res.status(401).json({
      code: -1,
      msg: "delete failed",
    })
    return
  }
  db.prepare("DELETE FROM comments WHERE commentId = ?").run(req.params.id)
  res.json({
    code: 0,
    msg: "delete success",
  })
})
//删除帖子 DELETE /post/5 HTTP/1.1
app.delete("/post/:id", (req, res, next) => {
  if (req.loginUser.userId !== req.params.id) {
    res.status(401).json({
      code: -1,
      msg: "delete failed",
    })
  }
  db.prepare("DELETE FROM posts WHERE postId = ?").run(req.params.id)
  db.prepare("DELETE FROM comments WHERE postId = ?").run(req.params.id)
  res.json({
    code: 0,
    msg: "delete success",
  })
})
//向帖子发表评论，id为帖子编号
app.post("/comment/post/:id", (req, res, next) => {
  if (req.isLogin) {
    var comment = req.body
    var user = req.loginUser //已登录用户
    comment.timestamp = new Date().toISOString()
    comment.postId = req.params.id
    comment.userId = user.userId
    var result = db
      .prepare(
        "INSERT INTO comments (content, postId, userId, timestamp) VALUES (@content, @postId, @userId, @timestamp)"
      )
      .run(comment)
    res.redirect(req.headers.referer || "/")
  } else {
    res.render("not-login.pug")
  }
})

//注册
app
  .route("/register")
  .get((req, res, next) => {
    res.render("register.pug")
  })
  .post((req, res, next) => {
    var regInfo = req.body
    //用户名只由字母数字下划线组成
    var USERNAME_RE = /^[0-9a-z_]+$/i
    //避免用户名或邮箱重复
    if (!USERNAME_RE.test(regInfo.name)) {
      res
        .status(400)
        .end("username invalid, can only contain digit and letter and _")
    } else if (regInfo.password == 0) {
      res.status(400).end("password may not be empty")
    } else {
      var addUSer = db.prepare(
        "INSERT INTO users (name,password,email) VALUES (?,?,?)"
      )
      var result = addUSer.run(regInfo.name, regInfo.password, regInfo.email)
      console.log(result)
      res.render("register-success.pug")
    }
  })
app
  .route("/login")
  .get((req, res, next) => {
    res.render("login.pug", {
      referer: req.headers.referer,
    })
  })
  .post((req, res, next) => {
    var loginInfo = req.body
    var userStmt = db.prepare(
      "SELECT * FROM users WHERE name = ? AND password = ?"
    )
    var user = userStmt.get(loginInfo.name, loginInfo.password)
    if (user) {
      //Cookie 的作用就是用于解决 "如何记录客户端的用户信息":
      res.cookie("loginUser", user.name, {
        signed: true,
        // maxAge: 86400000, //相对过期时间点，多久过期，过期后浏览器会自动删除，并不在请求中带上
        // //expires: new Date(),//绝对过期时间点
        // httpOnly: true, //只在请求时带在头里，不能通过document.cookie读到
      })
      //res.end("login success")
      //登陆成功后跳转回原来页面
      res.redirect(loginInfo.return_to)
    } else {
      res.end("username or password incorrect")
    }
  })
//登出
app.get("/logout", (req, res, next) => {
  res.clearCookie("loginUser")
  //登出时返回原页面
  res.redirect("/" || req.headers.referer)
})
app.listen(port, () => {
  console.log("listening on port", port)
})
