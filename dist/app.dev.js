"use strict";

var express = require("express");

var fs = require("fs");

var path = require('path');

var exp = require("constants");

var cookieparser = require("cookie-parser"); //转译用户发送的数据避免安全问题


var escape = require("lodash/escape");

var port = 8008;
var app = express(); // 引入pug模板

app.set('views', path.join(__dirname, 'view'));
app.set('view engine', 'pug'); //程序启动后加载用户和帖子两个文件

var users = loadfile("./users.json");
var posts = loadfile("./posts.json");
var comments = loadfile("./comments.json"); //读取文件，读不到返回空数组

function loadfile(file) {
  try {
    var content = fs.readFileSync(file);
    return JSON.parse(content);
  } catch (e) {
    return [];
  }
} //每隔5秒钟存储一次注册和发帖数据


setInterval(function () {
  //null,2表示缩进
  fs.writeFileSync("./users.json", JSON.stringify(users, null, 2));
  fs.writeFileSync("./posts.json", JSON.stringify(posts, null, 2));
  fs.writeFileSync("./comments.json", JSON.stringify(comments, null, 2)); //console.log("saved")
}, 5000);
app.use(cookieparser("cookie sign secret")); //cookie签名的密码
//解析为json和url的请求体

app.use(express.json());
app.use(express.urlencoded()); //__dirname:当前模块

app.use(express["static"](__dirname + "/static")); //自己写的中间件，可以看到服务器有没有接受到相应的请求

app.use(function (req, res, next) {
  console.log(req.method, req.url, req.headers.cookie);
  next();
}); //判断是否登录

app.use(function (req, res, next) {
  if (req.signedCookies.loginUser) {
    req.isLogin = true;
  } else {
    req.isLogin = false;
  }

  next();
});
app.get("/", function (req, res, next) {
  res.setHeader("Content-Type", "text/html;charset=UTF-8"); //读不出数据默认为1

  var page = Number(req.query.page || 1);
  var pageSize = 10;
  var startIdx = (page - 1) * pageSize;
  var endIdx = startIdx + pageSize;
  var pagePosts = posts.slice(startIdx, endIdx);

  if (pagePosts.length == 0) {
    res.end("no this page");
    return;
  }

  res.end("\n    <h1>BBS</h1>\n    <div>\n    ".concat( //根据登录状态显示首页按钮
  req.isLogin ? "\n        <a href=\"/post\">\u53D1\u5E16</a>\n        <a href=\"/logout\">\u767B\u51FA</a>\n        " : "\n        <a href=\"/register\">\u6CE8\u518C</a>\n        <a href=\"/login\">\u767B\u5F55</a>\n    ", "\n    </div>\n    <ul>\n    ").concat(pagePosts.map(function (post) {
    return "<li><a href=\"/post/".concat(escape(post.id), "\">").concat(escape(post.title), "</a> by <span>").concat(escape(post.postedBy), "</span></li>");
  }).join("\n"), "\n    </ul>\n    <p>\n      <a href=\"/?page=").concat(page - 1, "\">\u4E0A\u4E00\u9875</a>\n      <a href=\"/?page=").concat(page + 1, "\">\u4E0B\u4E00\u9875</a>\n    </p>\n  "));
}); //发帖

app.route("/post").get(function (req, res, next) {
  res.sendFile(__dirname + "/static/post.html");
}).post(function (req, res, next) {
  var postInfo = req.body;
  var userName = req.signedCookies.loginUser;

  if (userName) {
    //获取时间戳
    postInfo.timestamp = new Date().toISOString(); //发帖人

    postInfo.id = posts.length;
    postInfo.postedBy = userName;
    posts.push(postInfo); //发帖成功后自动跳转

    res.redirect("/post/" + postInfo.id);
  } else {
    res.end("401 not login");
  }
});
app.get("/post/:id", function (req, res, next) {
  var postId = req.params.id;
  var post = posts.find(function (it) {
    return it.id == postId;
  });

  if (post) {
    //找到帖子对应的评论
    var postComments = comments.filter(function (it) {
      return it.postId == postId;
    });
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    res.end("\n    <h1>BBS</h1>\n    <div>\n    ".concat( //根据登录状态显示首页按钮
    req.signedCookies.loginUser ? "\n        <a href=\"/post\">\u53D1\u5E16</a>\n        <a href=\"/logout\">\u767B\u51FA</a>\n        " : "\n        <a href=\"/register\">\u6CE8\u518C</a>\n        <a href=\"/login\">\u767B\u5F55</a>\n    ", "\n    </div>\n    <h2>").concat(escape(post.title), "</h2>\n    <fieldset>").concat(escape(post.content), "</fieldset>\n    <hr></hr>\n    ").concat( //帖子下方的回复
    postComments.map(function (it) {
      return "\n        <fieldset>\n          <legend>".concat(escape(it.commentBy), "</legend>\n          <p>").concat(escape(it.content), "</p>\n        </fieldset>\n      ");
    }).join("\n"), "\n    ").concat(req.isLogin ? "\n      <form action=\"/comment/post/".concat(postId, "\" method=\"POST\">\n      <h3>\u53D1\u8868\u8BC4\u8BBA</h3>\n      <div><textarea name=\"content\"></textarea></div>\n      <button>\u5F00\u603C</button>\n    </form>\n      ") : "<p>\u60F3\u53D1\u8868\u8BC4\u8BBA\uFF1F\u8BF7 <a href=\"/login\">\u767B\u5F55</a>", " \n    "));
  } else {
    res.end("404 post not found");
  }
}); //向帖子发表评论，id为帖子编号

app.post("/comment/post/:id", function (req, res, next) {
  if (req.isLogin) {
    var comment = req.body;
    comment.timestamp = new Date().toISOString();
    comment.postId = req.params.id;
    comment.commentBy = req.signedCookies.loginUser;
    comments.push(comment);
    res.redirect(req.headers.referer || "/");
  } else {
    res.end("not login");
  }
}); //注册

app.route("/register").get(function (req, res, next) {
  res.sendFile(__dirname + "/static/register.html");
}).post(function (req, res, next) {
  var regInfo = req.body; //用户名只由字母数字下划线组成

  var USERNAME_RE = /^[0-9a-z_]+$/i; //避免用户名或邮箱重复

  if (!USERNAME_RE.test(regInfo.name)) {
    res.status(400).end("username invalid, can only contain digit and letter and _");
  } else if (users.some(function (it) {
    return it.name == regInfo.name;
  })) {
    res.status(400).end("username already exists");
  } else if (users.some(function (it) {
    return it.email == regInfo.email;
  })) {
    res.status(400).end("email already exists");
  } else if (regInfo.password == 0) {
    res.status(400).end("password may not be empty");
  } else {
    regInfo.id = users.length;
    users.push(regInfo);
    res.end("register success");
  }
});
app.route("/login").get(function (req, res, next) {
  //res.sendFile(__dirname + "/static/login.html")
  //console.log("从哪里进到login页面的", req.headers.referer)
  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  res.end("\n    <h1>\u767B\u5F55</h1>\n    <form action=\"/login\" method=\"POST\">\n    <div>Username:</div>\n    <input type=\"text\" name=\"name\" id=\"\" />\n    <div>Password:</div>\n    <input type=\"password\" name=\"password\" id=\"\" />\n    <input hidden name=\"return_to\" value=\"".concat(req.headers.referer || "/", "\" ></input>\n    <br>\n    <button>\u767B\u5F55</button>\n    </form>\n  "));
}).post(function (req, res, next) {
  var loginInfo = req.body;
  var user = users.find(function (it) {
    return it.name == loginInfo.name && it.password == loginInfo.password;
  });

  if (user) {
    //Cookie 的作用就是用于解决 "如何记录客户端的用户信息":
    res.cookie("loginUser", user.name, {
      signed: true // maxAge: 86400000, //相对过期时间点，多久过期，过期后浏览器会自动删除，并不在请求中带上
      // //expires: new Date(),//绝对过期时间点
      // httpOnly: true, //只在请求时带在头里，不能通过document.cookie读到

    }); //res.end("login success")
    //登陆成功后跳转回原来页面

    res.redirect(loginInfo.return_to);
  } else {
    res.end("username or password incorrect");
  }
}); //登出

app.get("/logout", function (req, res, next) {
  res.clearCookie("loginUser"); //登出时返回原页面

  res.redirect("/" || req.headers.referer);
});
app.listen(port, function () {
  console.log("listening on port", port);
});